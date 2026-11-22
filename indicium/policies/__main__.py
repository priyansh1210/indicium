"""Policy commands.

python -m indicium.policies fetch-cms L34220 [--out data/policies/drafts]
python -m indicium.policies check data/policies
"""

import argparse
import re
import sys
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from indicium.config import settings
from indicium.policies import store
from indicium.policies.cms import CmsClient
from indicium.policies.files import policy_files, read_policy, write_yaml


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m indicium.policies")
    commands = parser.add_subparsers(dest="command", required=True)
    fetch = commands.add_parser(
        "fetch-cms", help="Download an LCD as a policy draft without criteria"
    )
    fetch.add_argument("lcd", nargs="+", help="LCD display ids, e.g. L34220")
    fetch.add_argument("--out", type=Path, default=Path("data/policies/drafts"))
    check = commands.add_parser("check", help="Validate policy files")
    check.add_argument("paths", nargs="+", type=Path)
    load = commands.add_parser("load", help="Validate and store policy files as new versions")
    load.add_argument("paths", nargs="+", type=Path)
    load.add_argument("--publish", action="store_true", help="Also publish what was loaded")
    args = parser.parse_args(argv)

    if args.command == "fetch-cms":
        client = CmsClient()
        for lcd in args.lcd:
            draft = client.fetch_lcd(lcd)
            path = args.out / f"{draft['policy_id']}.yaml"
            write_yaml(draft, path)
            print(
                f"{path}: {len(draft['procedure_codes'])} procedure codes, "
                f"{len(draft['diagnosis_codes'])} diagnosis codes, "
                f"{len(draft['source_text'])} characters of policy text"
            )
            if not draft["procedure_codes"]:
                # Some contractors (DME) name the codes only in prose.
                named = sorted(set(re.findall(r"\b[A-V]\d{4}\b", draft["source_text"])))
                print(f"  no procedure codes in the CMS data; the text names: {', '.join(named)}")
        return 0

    if args.command == "load":
        policies = [read_policy(path) for path in policy_files(args.paths)]  # all valid, or none
        with psycopg.connect(settings().database_url, row_factory=dict_row) as conn:
            for policy in policies:
                version_id, created = store.save(conn, policy, "system:policy-loader")
                # Re-running a load must never undo a version an admin published since.
                if args.publish and (created or not store.has_published(conn, policy.policy_id)):
                    store.publish(conn, version_id, "system:policy-loader")
                state = "new version" if created else "unchanged"
                print(f"{policy.policy_id}: {state} (version id {version_id})")
        return 0

    failed = 0
    for path in policy_files(args.paths):
        try:
            policy = read_policy(path)
            print(f"ok    {path} ({policy.policy_id})")
        except ValueError as error:
            failed += 1
            print(f"FAIL  {error}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
