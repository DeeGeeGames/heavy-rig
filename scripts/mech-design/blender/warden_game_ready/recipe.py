"""Read explicit chassis decisions without importing Blender or modifying inputs."""

import hashlib
import json
import os
from pathlib import Path


def load_recipe(repo=None):
    root = Path(repo or os.environ['WARDEN_GAME_REPO']).resolve()
    path = Path(os.environ.get('WARDEN_GAME_RECIPE', root / 'design/mechs/assets/warden/game-ready/recipe.json')).resolve()
    config = json.loads(path.read_text())
    if config['schemaVersion'] != 1 or config['chassis'] != 'warden':
        raise ValueError('Expected the versioned Warden source recipe')
    for record in [config['inputs']['source'], config['inputs']['ownership'], *config['inputs']['pods']]:
        source = (root / record['path']).resolve()
        if not source.is_relative_to(root) or hashlib.sha256(source.read_bytes()).hexdigest() != record['sha256']:
            raise ValueError('Recipe input hash differs: ' + record['path'])
    return config
