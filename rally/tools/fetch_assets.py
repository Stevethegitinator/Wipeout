"""Downloads the CC0 surface scans and skies the stages use from Poly Haven
(https://polyhaven.com, CC0) and writes rally/assets/tex/manifest.json with
each texture's real-world size and authors (used for tiling and credits).

    python3 rally/tools/fetch_assets.py

Needs network access to api.polyhaven.com and dl.polyhaven.org, and ffmpeg
(to re-encode the JPEGs smaller).
"""
import json, os, subprocess, tempfile, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")

# Per stage: road surface, then the three terrain layers (grass, dirt, rock).
STAGE_TEXTURES = {
    "harrow": {"road": "forest_ground_04", "grass": "grass_ground", "dirt": "brown_mud_rocks_01", "rock": "rock_face_03"},
    "lakes": {"road": "gravel_ground_01", "grass": "leafy_grass", "dirt": "forest_floor", "rock": "lichen_rock"},
    "corse": {"road": "asphalt_02", "grass": "withered_grass", "dirt": "dry_ground_01", "rock": "rock_face"},
    "varm": {"road": "snow_05", "grass": "snow_02", "dirt": "snow_03", "rock": "dark_rock"},
    "outback": {"road": "rocky_gravel", "grass": "dry_ground_rocks", "dirt": "red_dirt_mud_01", "rock": "terrain_red_01"},
    "wales": {"road": "stony_dirt_path", "grass": "grass_ground", "dirt": "brown_mud_leaves_01", "rock": "mossy_rock"},
}
STAGE_HDRIS = {
    "harrow": "forest_slope", "lakes": "forest_grove", "corse": "drakensberg_solitary_mountain",
    "varm": "kloppenheim_02", "outback": "aarfontein_dirt_road", "wales": "hochsal_forest",
}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "over-crest-rally asset fetch"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def recode(data, out, size=None, quality=4):
    with tempfile.NamedTemporaryFile(suffix=".jpg") as t:
        t.write(data); t.flush()
        args = ["ffmpeg", "-loglevel", "error", "-y", "-i", t.name]
        if size:
            args += ["-vf", f"scale={size}:{size}"]
        subprocess.run(args + ["-q:v", str(quality), out], check=True)


def main():
    manifest = {"textures": {}, "hdris": {}}
    roads = {v["road"] for v in STAGE_TEXTURES.values()}
    names = sorted({n for v in STAGE_TEXTURES.values() for n in v.values()})
    for name in names:
        files = json.loads(get(f"https://api.polyhaven.com/files/{name}"))
        info = json.loads(get(f"https://api.polyhaven.com/info/{name}"))
        d = os.path.join(ROOT, "tex", name)
        os.makedirs(d, exist_ok=True)
        res = "2k" if name in roads else "1k"
        recode(get(files["Diffuse"][res]["jpg"]["url"]), os.path.join(d, "diff.jpg"), quality=3)
        recode(get(files["nor_gl"]["1k"]["jpg"]["url"]), os.path.join(d, "nor.jpg"), quality=4)
        if "arm" in files:
            recode(get(files["arm"]["1k"]["jpg"]["url"]), os.path.join(d, "arm.jpg"), size=512, quality=5)
        dims = info.get("dimensions") or [2000, 2000]
        manifest["textures"][name] = {"size": [dims[0] / 1000, dims[1] / 1000], "authors": list(info.get("authors", {}).keys()), "arm": "arm" in files}
        print(name, res, manifest["textures"][name]["size"])
    for name in sorted(set(STAGE_HDRIS.values())):
        files = json.loads(get(f"https://api.polyhaven.com/files/{name}"))
        info = json.loads(get(f"https://api.polyhaven.com/info/{name}"))
        os.makedirs(os.path.join(ROOT, "hdri"), exist_ok=True)
        path = os.path.join(ROOT, "hdri", f"{name}_1k.exr")
        if not os.path.exists(path):
            with open(path, "wb") as f:
                f.write(get(files["hdri"]["1k"]["exr"]["url"]))
        manifest["hdris"][name] = {"authors": list(info.get("authors", {}).keys())}
        print("hdri", name)
    manifest["stages"] = {k: {**v, "hdri": STAGE_HDRIS[k]} for k, v in STAGE_TEXTURES.items()}
    with open(os.path.join(ROOT, "tex", "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    # Remove scans no stage uses any more.
    for d in os.listdir(os.path.join(ROOT, "tex")):
        p = os.path.join(ROOT, "tex", d)
        if os.path.isdir(p) and d not in manifest["textures"]:
            for f in os.listdir(p):
                os.remove(os.path.join(p, f))
            os.rmdir(p)


if __name__ == "__main__":
    main()
