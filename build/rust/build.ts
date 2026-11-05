/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workspace = resolve(root, 'rust');
const manifest = readFileSync(resolve(workspace, 'editor-wasm/Cargo.toml'), 'utf8');
const bindingVersion = /wasm-bindgen = "=(?<version>[\d.]+)"/.exec(manifest)?.groups?.version;
if (!bindingVersion) {
	throw new Error('The WebAssembly binding version must be pinned');
}

/** Runs tools without a shell, retaining paths with spaces and propagating failed builds. */
function run(command: string, args: string[]): void {
	const result = spawnSync(command, args, { cwd: workspace, stdio: 'inherit', windowsHide: true });
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

const bindingTool = spawnSync('wasm-bindgen', ['--version'], { cwd: workspace, encoding: 'utf8', windowsHide: true });
if (bindingTool.error || bindingTool.stdout.trim() !== `wasm-bindgen ${bindingVersion}`) {
	throw new Error(`Install the matching bindings tool with: cargo install wasm-bindgen-cli --version ${bindingVersion} --locked`);
}

run('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'vscode-editor-wasm']);
run('wasm-bindgen', [
	resolve(workspace, 'target/wasm32-unknown-unknown/release/vscode_editor_wasm.wasm'),
	'--target', 'web',
	'--out-dir', resolve(root, 'out/vs/editor/common/model/rustTextBuffer'),
	'--out-name', 'vscode_editor_wasm'
]);
