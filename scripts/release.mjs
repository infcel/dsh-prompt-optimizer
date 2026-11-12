#!/usr/bin/env node
// 打发布包：把插件复制到临时目录，改写包名与 patch，再 npm pack。
//
// 用法：
//   node scripts/release.mjs                          # 用 package.json 里的名字，产出 dist/
//   node scripts/release.mjs --name @you/dsh-prompt-optimizer
//   node scripts/release.mjs --name dsh-prompt-optimizer --version 1.0.1
//
// 为什么复制而不是就地改：本机 profile 用 link: 指向这个目录，
// 就地改 package.json 的 name 会让正在跑的实例与 patch 对不上。

import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function arg(name, fallback) {
	const i = process.argv.indexOf(`--${name}`)
	return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const name = arg('name', pkg.publishName ?? pkg.name)
const version = arg('version', pkg.version)
const out = resolve(root, arg('out', 'dist'))

if (name.startsWith('@local/')) {
	console.error(`拒绝打包：${name} 是本地占位名，不能发布。用 --name 指定真实包名。`)
	process.exit(1)
}

const stage = mkdtempSync(join(tmpdir(), 'po-release-'))
try {
	// 整个目录复制过去，由 package.json 的 files 字段决定 npm pack 收哪些。
	const skip = new Set(['node_modules', 'dist', 'test', 'scripts', '.git'])
	cpSync(root, stage, {
		recursive: true,
		filter: (src) => {
			const rel = src.slice(root.length + 1)
			if (!rel) return true
			return !skip.has(rel.split('/')[0]) && !rel.endsWith('.bak')
		},
	})

	const manifest = { ...pkg, name, version, private: false }
	writeFileSync(join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

	const patchPath = join(stage, 'cordis.patch.yml')
	const patch = readFileSync(patchPath, 'utf8')
	const rewritten = patch.replace(/name: '[^']*'/, `name: '${name}'`)
	if (rewritten === patch && !patch.includes(`name: '${name}'`)) {
		console.error('拒绝打包：cordis.patch.yml 里没找到可改写的 name。')
		process.exit(1)
	}
	writeFileSync(patchPath, rewritten)

	for (const file of ['index.js', 'client.js', 'lib/heuristic.js', 'lib/templates.js', 'lib/sse.js']) {
		execFileSync(process.execPath, ['--check', join(stage, file)], { stdio: 'inherit' })
	}

	mkdirSync(out, { recursive: true })
	const packed = execFileSync('npm', ['pack', '--pack-destination', out, '--json'], {
		cwd: stage,
		encoding: 'utf8',
	})
	const [info] = JSON.parse(packed)
	console.log(`\n打包完成：${join(out, info.filename)}`)
	console.log(`包名 ${name}@${version}，${info.entryCount} 个文件，${(info.size / 1024).toFixed(1)} KB`)
	for (const f of info.files) console.log(`  ${f.path}`)
	console.log(`\n发布：npm publish ${join(out, info.filename)} --access public`)
} finally {
	rmSync(stage, { recursive: true, force: true })
}
