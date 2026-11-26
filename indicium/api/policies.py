"""Policy routes: list, read, add a draft version, publish."""

import yaml
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field, ValidationError

from indicium.api.auth import Manager, Reader
from indicium.db import Db
from indicium.policies import store
from indicium.policies.model import Policy, criteria_of
from indicium.text import locate

router = APIRouter(prefix="/policies", tags=["policies"])


@router.get("")
def list_policies(principal: Reader, db: Db) -> list[dict]:
    return db.execute(
        "select v.version_id, v.policy_id, v.version, v.title, v.status, v.created_at,"
        " v.published_at, v.document->'source'->>'document_id' as source_document,"
        " (select array_agg(code order by code) from policy.procedure_codes c"
        "   where c.version_id = v.version_id) as procedure_codes"
        " from policy.versions v order by v.policy_id, v.version desc"
    ).fetchall()


@router.get("/versions/{version_id}")
def read_version(version_id: int, principal: Reader, db: Db) -> dict:
    row = db.execute(
        "select version_id, policy_id, version, status, document, created_by, created_at,"
        " published_by, published_at from policy.versions where version_id = %s",
        (version_id,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "No such policy version")
    # Where each criterion's source sentence sits in the policy text, for highlighting.
    policy = Policy.model_validate(row["document"])
    row["source_spans"] = {
        c.id: locate(c.source_quote, policy.source_text) for c in criteria_of(policy.criteria)
    }
    return row


@router.post("", status_code=201)
def add_version(policy: Policy, principal: Manager, db: Db, response: Response) -> dict:
    """Store a policy as a draft. Identical content returns the existing version."""
    version_id, created = store.save(db, policy, principal.actor)
    if not created:
        response.status_code = 200
    return {"version_id": version_id, "created": created}


class PolicyFile(BaseModel):
    yaml: str = Field(min_length=10, max_length=2_000_000)


@router.post("/yaml", status_code=201)
def add_version_from_file(body: PolicyFile, principal: Manager, db: Db, response: Response) -> dict:
    """The same as adding a version, from the text of a policy file (data/policies/*.yaml)."""
    try:
        policy = Policy.model_validate(yaml.safe_load(body.yaml))
    except yaml.YAMLError as error:
        raise HTTPException(422, f"Not readable as YAML: {error}") from error
    except ValidationError as error:
        problems = "; ".join(
            f"{'.'.join(map(str, e['loc'])) or 'file'}: {e['msg']}" for e in error.errors()[:5]
        )
        raise HTTPException(422, f"Not a valid policy. {problems}") from error
    return add_version(policy, principal, db, response)


@router.post("/versions/{version_id}/publish")
def publish(version_id: int, principal: Manager, db: Db) -> dict:
    try:
        store.publish(db, version_id, principal.actor)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    return {"version_id": version_id, "status": "published"}
