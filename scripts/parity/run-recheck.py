"""Compare a Node reference CLI and a Linux x64 port using RECHECK."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory


CASE_FIELDS = {'id', 'fixture', 'expected', 'policy', 'timeout', 'output_limit', 'memory_mb', 'repetitions'}
CASE_ID = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}\Z')


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def read_text(path):
    return path.read_bytes().decode('utf-8-sig')


def file_under(root, name):
    if not isinstance(name, str) or Path(name).is_absolute():
        raise ValueError(f'Expected a relative file path, got {name!r}.')
    path = (root / name).resolve(strict=True)
    path.relative_to(root)
    if not path.is_file():
        raise ValueError(f'Expected a regular file at {path}.')
    return path


def prepare_cases(path, stdin):
    path = path.resolve(strict=True)
    cases = json.loads(read_text(path))
    if not isinstance(cases, list) or not 1 <= len(cases) <= 200:
        raise ValueError('The cases file must contain 1–200 case objects.')
    seen = set()
    prepared = []
    for case in cases:
        if not isinstance(case, dict) or case.keys() - CASE_FIELDS:
            raise ValueError(f'Invalid case object {case!r}.')
        identifier = case.get('id')
        if not isinstance(identifier, str) or not CASE_ID.fullmatch(identifier) or identifier.casefold() in seen:
            raise ValueError(f'Invalid or duplicate case ID {identifier!r}.')
        seen.add(identifier.casefold())
        fixture = file_under(path.parent, case.get('fixture'))
        name = f'fixtures/{identifier}.json'
        if stdin:
            source = read_text(fixture)
            if len(source) > 8192 or '\0' in source:
                raise ValueError(f'Case {identifier} exceeds RECHECK stdin limits. Use --input arg.')
            data = {'stdin': source}
        else:
            data = {'args': [name]}
        expected = {'exit_code': 0, 'stderr': ''}
        if 'expected' in case:
            source = read_text(file_under(path.parent, case['expected']))
            json.loads(source)
            expected['stdout'] = source
        policy = {'stdout': 'json', 'stderr': 'bytes'} | case.get('policy', {})
        scenario = {
            'id': identifier, 'kind': 'console', 'input': data, 'policy': policy,
            'expected': {'reference': expected, 'candidate': expected},
            'fixtures': [] if stdin else [name],
        }
        for field in ('timeout', 'output_limit', 'memory_mb', 'repetitions'):
            if field in case:
                scenario[field] = case[field]
        prepared.append((scenario, fixture))
    return prepared


def checked_image(image):
    inspected = subprocess.run(
        ['docker', 'image', 'inspect', image, '--format', '{{.Id}} {{.Os}} {{.Architecture}}'],
        check=True, capture_output=True, text=True,
    ).stdout.split()
    if len(inspected) != 3 or inspected[1:] != ['linux', 'amd64'] or not re.fullmatch(r'sha256:[a-f0-9]{64}', inspected[0]):
        raise ValueError(f'Expected a local Linux x64 RECHECK worker image, got {inspected!r}.')
    return inspected[0]


def stage_inputs(args):
    cases = prepare_cases(args.cases, args.input == 'stdin')
    reference = args.reference.resolve(strict=True)
    root = args.reference_root.resolve(strict=True) if args.reference_root else reference.parent
    reference_sources = [reference, *(file_under(root, name) for name in args.reference_file)]
    reference_files = {
        'reference/' + source.relative_to(root).as_posix(): source for source in reference_sources
    }
    candidate = args.candidate.resolve(strict=True)
    if not reference.is_file() or not candidate.is_file():
        raise ValueError('The reference and candidate must be regular files.')
    image_id = checked_image(args.image)

    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    directory = output / 'input'
    candidate_entry = 'candidate/port-linux-x64'
    files = reference_files | {candidate_entry: candidate}
    files.update({scenario['fixtures'][0]: fixture for scenario, fixture in cases if scenario['fixtures']})
    for name, source in files.items():
        destination = directory / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)

    platform = dict(os='linux', arch='x64')
    targets = {
        'reference': dict(
            platform, runtime='node', language=args.reference_language, entry=next(iter(reference_files)),
            files=list(reference_files)[1:],
        ),
        'candidate': dict(platform, runtime='native', language=args.language, entry=candidate_entry),
    }
    manifest = directory / 'manifest.json'
    write_json(manifest, {
        'schema_version': 'recheck-porting-1', 'description': args.description,
        'targets': targets, 'scenarios': [scenario for scenario, _ in cases],
        'structure': {'enabled': False}, 'concurrency': args.concurrency,
    })
    worker = directory / 'worker.json'
    write_json(worker, {'workers': {'default': dict(platform, kind='docker', image=image_id)}})
    return output, manifest, worker


def describe(result):
    scenarios = []
    for row in result['scenarios']:
        attempts = []
        for attempt in row['attempts']:
            observations = {}
            for side, observed in attempt['observations'].items():
                observations[side] = {
                    key: observed[key]
                    for key in ('status', 'exit_code', 'target_sha256', 'entry_sha256', 'environment')
                    if key in observed
                }
                if 'runtime' in observed:
                    observations[side]['runtime_version'] = observed['runtime'].get('version')
            comparison = attempt['comparison']
            attempts.append({
                'observations': observations, 'differences': comparison['differences'],
                'raw_differences': comparison['raw_differences'], 'errors': comparison['errors'],
            })
        scenarios.append({
            'id': row['id'], 'outcome': row['outcome'], 'acceptance': row['acceptance'], 'attempts': attempts,
        })
    return {
        'schema_version': 'recheck-cli-parity-summary-1',
        'run_id': result['run_id'], 'manifest_sha256': result['manifest_sha256'],
        'status': result['status'], 'behavior': result['behavior'], 'scenarios': scenarios,
    }


def run_recheck(args, output, manifest, worker):
    checkout = args.recheck.resolve(strict=True)
    if not (checkout / 'recheck' / 'porting_worker.py').is_file():
        raise ValueError('The RECHECK checkout must include its porting implementation.')
    venv_python = checkout / ('.venv/Scripts/python.exe' if sys.platform == 'win32' else '.venv/bin/python')
    python = args.python.absolute() if args.python else (venv_python if venv_python.is_file() else sys.executable)
    with TemporaryDirectory(prefix='recheck-cli-parity-') as temporary:
        workspace = Path(temporary)
        data = workspace / 'data'
        common = [str(python), '-m', 'recheck', '--data-dir', str(data), '--settings-dir', str(workspace / 'settings')]
        result_path = output / 'result.json'
        execution = subprocess.run(
            [*common, '--json-output', str(result_path), 'porting-run', str(manifest), '--worker', str(worker)],
            cwd=checkout, stdout=subprocess.DEVNULL, check=False,
        )
        if not result_path.is_file():
            raise ValueError(f'RECHECK produced no result file (exit {execution.returncode}).')
        result = json.loads(read_text(result_path))
        if result.get('schema_version') != 'recheck-porting-result-1':
            raise ValueError(f"RECHECK rejected the comparison: {result.get('message', result)}")
        run_id = result['run_id']
        subprocess.run([*common, 'report', run_id], cwd=checkout, stdout=subprocess.DEVNULL, check=True)
        shutil.copyfile(data / 'runs' / run_id / 'report.html', output / 'report.html')
    summary = describe(result)
    summary['result_sha256'] = hashlib.sha256(result_path.read_bytes()).hexdigest()
    write_json(output / 'summary.json', summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recheck', type=Path, required=True, help='RECHECK source checkout')
    parser.add_argument('--reference', type=Path, required=True, help='Node entry script')
    parser.add_argument('--reference-root', type=Path, help='Root directory for Node entry and dependency paths')
    parser.add_argument('--reference-file', action='append', default=[], help='Dependency path relative to reference root')
    parser.add_argument('--reference-language', default='javascript')
    parser.add_argument('--candidate', type=Path, required=True, help='Prebuilt Linux x64 ELF executable')
    parser.add_argument('--language', required=True, help='Candidate source language')
    parser.add_argument('--cases', type=Path, required=True, help='Case list JSON with fixture paths')
    parser.add_argument('--output', type=Path, required=True, help='New directory for result, report, and staged inputs')
    parser.add_argument('--image', default='recheck-porting:laptop-linux-x64', help='Local RECHECK worker tag or image ID')
    parser.add_argument('--python', type=Path, help='Interpreter with RECHECK dependencies')
    parser.add_argument('--description', default='Node and native CLI output comparison')
    parser.add_argument('--input', choices=('arg', 'stdin'), default='arg', help='Pass fixtures by path or by stdin')
    parser.add_argument('--concurrency', type=int, choices=range(1, 9), default=3)
    args = parser.parse_args()
    try:
        output, manifest, worker = stage_inputs(args)
        summary = run_recheck(args, output, manifest, worker)
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        detail = exc.stderr.strip() if isinstance(exc, subprocess.CalledProcessError) and exc.stderr else str(exc)
        print(detail, file=sys.stderr)
        return 2
    behavior = summary['behavior']
    print(f"{summary['run_id']}  {behavior['matched']}/{behavior['registered']} matched  {behavior['acceptance']}")
    return int(not (behavior['matched'] == behavior['registered'] and behavior['acceptance'] == 'passed'))


if __name__ == '__main__':
    sys.exit(main())
