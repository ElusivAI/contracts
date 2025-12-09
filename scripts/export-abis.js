#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..', '..')
const artifactsDir = path.resolve(__dirname, '..', 'artifacts', 'contracts')
const candidateDirs = [
  path.resolve(root, 'frontend', 'src', 'lib', 'abis'),
  path.resolve(root, 'backend', 'lib', 'abis')
]

const outDirs = candidateDirs.filter((dir) => fs.existsSync(path.dirname(dir)))

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function writeAbi(name) {
  const artifactPath = path.join(artifactsDir, `${name}.sol`, `${name}.json`)
  if (!fs.existsSync(artifactPath)) {
    console.error(`Artifact not found for ${name}: ${artifactPath}`)
    process.exitCode = 1
    return
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  const abi = artifact.abi
  outDirs.forEach((dir) => {
    ensureDir(dir)
    const outPath = path.join(dir, `${name}.json`)
  fs.writeFileSync(outPath, JSON.stringify(abi, null, 2))
  console.log(`Exported ABI: ${outPath}`)
  })
}

function main() {
  const names = ['ElusivToken', 'ElusivAccessPass', 'ElusivResearchDesk']
  if (outDirs.length === 0) {
    console.warn('No ABI output directories found. Skipping export.')
    return
  }
  names.forEach(writeAbi)
}

main()
