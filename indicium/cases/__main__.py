"""Case commands.

python -m indicium.cases check data/cases     validate the labelled dataset against its policies
python -m indicium.cases load data/cases      store and queue the dataset's requests (demo data)
    --sample-practice                         as requests from the demo's sample practice
"""

import argparse
import sys
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from indicium.api.users import demo_practice
from indicium.cases.dataset import check_case, read_cases
from indicium.cases.store import DuplicateRequest, create_case
from indicium.config import settings
from indicium.policies.files import policy_files, read_policy
from indicium.review.worker import enqueue


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m indicium.cases")
    parser.add_argument("command", choices=["check", "load"])
    parser.add_argument("root", type=Path)
    parser.add_argument("--policies", type=Path, default=Path("data/policies"))
    parser.add_argument("--sample-practice", action="store_true")
    args = parser.parse_args(argv)
    cases = read_cases(args.root)

    if args.command == "check":
        policies = {p.policy_id: p for p in map(read_policy, policy_files([args.policies]))}
        failed = 0
        for case in cases:
            policy = policies.get(case.policy_id)
            problems = check_case(case, policy) if policy else [f"no policy {case.policy_id}"]
            failed += bool(problems)
            for problem in problems:
                print(f"FAIL  {case.case_id}: {problem}", file=sys.stderr)
        print(f"{len(cases) - failed} of {len(cases)} cases are consistent")
        return 1 if failed else 0

    with psycopg.connect(settings().database_url, row_factory=dict_row) as conn:
        practice = demo_practice(conn) if args.sample_practice else None
        created = 0
        for case in cases:
            try:
                case_id, new = create_case(conn, case.request, "system:dataset-loader", practice)
                if new:  # a new case is queued for review in the same transaction
                    enqueue(conn, case_id, "system:dataset-loader")
                created += new
            except DuplicateRequest:
                print(f"{case.case_id}: changed since it was loaded; the stored version is kept")
            conn.commit()  # one case per transaction, so one bad case never undoes the others
    print(f"{created} new cases out of {len(cases)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
