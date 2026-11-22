"""Policy files: YAML on disk, one policy per file, validated on read."""

from pathlib import Path

import yaml

from indicium.policies.model import Policy


class _Dumper(yaml.SafeDumper):
    pass


def _str(dumper: yaml.SafeDumper, value: str) -> yaml.ScalarNode:
    # Multi-line text (the policy text) is written as a readable block, not one escaped line.
    style = "|" if "\n" in value else None
    return dumper.represent_scalar("tag:yaml.org,2002:str", value, style=style)


_Dumper.add_representer(str, _str)


def write_yaml(data: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = yaml.dump(data, Dumper=_Dumper, sort_keys=False, allow_unicode=True, width=100)
    with path.open("w", encoding="utf-8", newline="") as file:  # LF on every OS
        file.write(text)


def read_policy(path: Path) -> Policy:
    """A validated policy. Raises ValueError naming the file and every problem in it."""
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        return Policy.model_validate(data)
    except (yaml.YAMLError, ValueError) as error:
        raise ValueError(f"{path}: {error}") from error


def policy_files(paths: list[Path]) -> list[Path]:
    """The .yaml files named, or found in the folders named."""
    found = []
    for path in paths:
        found += sorted(path.glob("*.yaml")) if path.is_dir() else [path]
    return found
