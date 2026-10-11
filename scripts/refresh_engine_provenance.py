"""Refresh packaged artifact identity without reclassifying historical protocols."""
import hashlib
import json
import pathlib


def refresh(root):
    library = root / "apps" / "micropolis" / "src" / "lib"
    manifest = library / "city-run" / "engine-provenance.json"
    provenance = json.loads(manifest.read_text(encoding="utf-8"))
    hashes = {
        extension: hashlib.sha256(
            (library / f"micropolisengine.{extension}").read_bytes()
        ).hexdigest()
        for extension in ("js", "wasm", "data")
    }
    identity = "sha256:" + hashlib.sha256(
        json.dumps(hashes, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    provenance["engineHashes"] = hashes
    provenance["engineId"] = identity
    provenance["verifiedProtocols"] = [
        entry for entry in provenance.get("verifiedProtocols", [])
        if entry["engineId"] == identity
    ]
    manifest.write_text(
        json.dumps(provenance, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Packaged engine identity: {identity}")


if __name__ == "__main__":
    refresh(pathlib.Path(__file__).resolve().parent.parent)
