"""Package one approved locomotion checkpoint without altering its source."""
import argparse
import json
import runpy
import sys
from pathlib import Path

import bpy

parser = argparse.ArgumentParser()
parser.add_argument('--repo', required=True, type=Path)
parser.add_argument('--motion', required=True, choices=('walk', 'run', 'backward'))
parser.add_argument('--output', required=True)
parser.add_argument('--origins', type=Path, help='Optional measured physical firing exits JSON.')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
root = args.repo.resolve()
output = Path(args.output)
if output.is_absolute() or len(output.parts) != 1 or output.name in ('.', '..'):
    raise ValueError('Output must be a new candidate folder name.')
record = json.loads((root / 'design/mechs/chassis/warden/approved-locomotion.json').read_text())
source = record['motions'][args.motion]['artifacts']['motion.blend']
with bpy.data.libraries.load(str(root / source['path']), link=False) as (available, unused):
    scenes = list(available.scenes)
if len(scenes) != 1:
    raise RuntimeError('Expected exactly one scene in the approved motion checkpoint.')
runpy.run_path(str(root / 'scripts/mech-design/blender/package_components.py'), init_globals={
    'REPO_ROOT': str(root), 'OUTPUT_FOLDER': args.output,
    'SOURCE_OVERRIDE': source, 'SOURCE_SCENE': scenes[0],
    'FIRING_ORIGINS': str(args.origins.resolve()) if args.origins else None,
})
