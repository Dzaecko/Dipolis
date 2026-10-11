"""Build an isolated, source-symbolized WASM memory diagnostic engine."""
import argparse
import os
import pathlib
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("--compiler", default="em++")
parser.add_argument("--production", action="store_true")
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parent.parent
engine = root / "packages" / "micropolis-engine"
output = engine / "build" / ("production" if args.production else "diagnostics")
subprocess.run(["make", "clean"], cwd=engine, check=True)
output.mkdir(parents=True, exist_ok=True)
flags = "-O1 -g -fsanitize=address,undefined -fno-sanitize-recover=all"
if args.production:
    flags = ""
scratch = engine / ".compiler-scratch"
scratch.mkdir(exist_ok=True)
environment = {**os.environ, "TMPDIR": str(scratch), "TEMP": str(scratch), "TMP": str(scratch)}
link = (
    flags + " -sASSERTIONS=2 -sWASM=1 -sMODULARIZE=1 -sEXPORT_ES6=1"
    " -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1"
    ' -sEXPORTED_RUNTIME_METHODS=["HEAPU16","wasmMemory"]'
    " -lembind"
    " --shell-file src/micropolisengine_template.html"
    " --js-library src/micropolisengine_lib.js"
    " --preload-file ../../content/micropolis/cities@cities/"
)
subprocess.run([
    "make", "-j4", "all", f"EMCC={args.compiler}",
    f"EMCXXFLAGS=-std=c++17 -fPIC {flags}", f"EMLDFLAGS={link}",
    f"LIBRARY=build/{output.name}/micropolisengine",
], cwd=engine, env=environment, check=True)
if args.production:
    import shutil
    destination = root / "apps" / "micropolis" / "src" / "lib"
    for extension in ("wasm", "data"):
        shutil.copy2(output / f"micropolisengine.{extension}", destination)
    source = (output / "micropolisengine.js").read_text(encoding="utf-8")
    (destination / "micropolisengine.js").write_text(
        "// @ts-nocheck\n" + "\n".join(line.rstrip() for line in source.splitlines()).rstrip() + "\n",
        encoding="utf-8",
    )
    from refresh_engine_provenance import refresh
    refresh(root)
