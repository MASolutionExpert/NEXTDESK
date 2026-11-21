import path from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

export const scriptDir: any = path.dirname(fileURLToPath(import.meta.url))
export const serverDir: any = path.resolve(scriptDir, '..')
export const projectRootDir: any = path.resolve(serverDir, '..', '..')
export const dataDir: any = path.resolve(process.env.DATA_DIR || path.resolve(projectRootDir, 'data'))

function parseNpmOriginalArgs() {
  const raw = process.env.npm_config_argv
  if (!raw) return []
  try {
    const parsed: any = JSON.parse(raw)
    const original = Array.isArray(parsed?.original) ? parsed.original : []
    const normalized: any = original.map((arg) => String(arg).trim()).filter(Boolean)
    const lifecycle: any = String(process.env.npm_lifecycle_event || '').trim()
    if (!lifecycle) {
      return normalized
    }
    const scriptIndex: any = normalized.findIndex((arg) => arg === lifecycle)
    if (scriptIndex >= 0) {
      return normalized.slice(scriptIndex + 1).filter((arg) => arg !== '--')
    }
    return normalized
  } catch (_) {
    return []
  }
}

export function getNpmOriginalArgs() {
  return parseNpmOriginalArgs()
}

export function getCliArgs() {
  const directArgs: any = process.argv.slice(2).map((arg) => String(arg).trim()).filter(Boolean)
  const npmArgs: any = parseNpmOriginalArgs()
  if (!directArgs.length) return npmArgs
  if (!npmArgs.length) return directArgs
  const merged = [...directArgs]
  npmArgs.forEach((arg) => {
    if (!merged.includes(arg)) {
      merged.push(arg)
    }
  })
  return merged
}

export function hasForceYes(args: any = []) {
  const normalized: any = args.map((arg) => String(arg).toLowerCase())
  if (normalized.includes('-y') || normalized.includes('--yes')) return true
  const envYes: any = String(process.env.npm_config_yes || '').toLowerCase()
  if (envYes === 'true' || envYes === '1') return true
  const envY: any = String(process.env.npm_config_y || '').toLowerCase()
  if (envY === 'true' || envY === '1') return true
  return false
}

export function getPositionalArgs(args: any = []) {
  return args.filter((arg) => !String(arg).startsWith('-'))
}

export function getFlagValue(args: any = [], flagName) {
  const normalizedFlag: any = String(flagName).toLowerCase()
  const index: any = args.findIndex((arg) => String(arg).toLowerCase() === normalizedFlag)
  if (index >= 0) {
    return args[index + 1] || null
  }
  const inlineArg: any = args.find((arg) => {
    const value: any = String(arg).toLowerCase()
    return value.startsWith(`${normalizedFlag}=`) && value.length > normalizedFlag.length + 1
  })
  if (inlineArg) {
    return String(inlineArg).slice(normalizedFlag.length + 1) || null
  }
  const envKey = `npm_config_${String(flagName)
    .replace(/^-+/, '')
    .replace(/-/g, '_')
    .toLowerCase()}`
  const envValue = process.env[envKey]
  if (typeof envValue === 'string' && envValue.trim()) {
    return envValue.trim()
  }
  return null
}

export function hasFlag(args: any = [], flagName) {
  const normalizedFlag: any = String(flagName).toLowerCase()
  if (args.some((arg) => String(arg).toLowerCase() === normalizedFlag)) {
    return true
  }
  const envKey = `npm_config_${String(flagName)
    .replace(/^-+/, '')
    .replace(/-/g, '_')
    .toLowerCase()}`
  const envValue: any = String(process.env[envKey] || '').trim().toLowerCase()
  return envValue === 'true' || envValue === '1'
}

export async function confirmAction({
  prompt,
  force = false,
  forceHint,
  defaultAnswer = null,
}: any) {
  if (force) return true
  if (!input.isTTY) {
    if (forceHint) {
      console.error(forceHint)
    } else {
      console.error('Refusing to continue in non-interactive mode without -y/--yes.')
    }
    process.exit(1)
  }

  const rl: any = readline.createInterface({ input, output })
  try {
    const normalizedDefault =
      String(defaultAnswer || '')
        .trim()
        .toLowerCase() === 'yes'
        ? 'yes'
        : String(defaultAnswer || '')
            .trim()
            .toLowerCase() === 'no'
          ? 'no'
          : null
    const promptSuffix = normalizedDefault
      ? ` (y/n, default: ${normalizedDefault}): `
      : ' (y/n): '
    while (true) {
      const answer: any = (await rl.question(`${prompt}${promptSuffix}`)).trim().toLowerCase()
      if (!answer && normalizedDefault === 'yes') return true
      if (!answer && normalizedDefault === 'no') return false
      if (answer === 'y' || answer === 'yes') return true
      if (answer === 'n' || answer === 'no') return false
    }
  } finally {
    rl.close()
  }
}

export async function promptInput({ prompt, required = false }: any = {}) {
  if (!input.isTTY) {
    console.error('Interactive input required, but no TTY is available.')
    process.exit(1)
  }
  const rl: any = readline.createInterface({ input, output })
  try {
    while (true) {
      const answer: any = String(await rl.question(prompt || '')).trim()
      if (!required || answer) return answer
    }
  } finally {
    rl.close()
  }
}

export async function promptSecret({ prompt, required = false }: any = {}) {
  if (!input.isTTY) {
    console.error('Interactive secret input required, but no TTY is available.')
    process.exit(1)
  }
  const rl: any = readline.createInterface({
    input,
    output,
    terminal: true,
  })
  const originalWrite: any = rl._writeToOutput?.bind(rl)
  rl._writeToOutput = (stringToWrite) => {
    if (rl.stdoutMuted) {
      rl.output.write('*')
      return
    }
    if (originalWrite) {
      originalWrite(stringToWrite)
      return
    }
    rl.output.write(stringToWrite)
  }
  try {
    while (true) {
      rl.stdoutMuted = false
      rl.output.write(prompt || '')
      rl.stdoutMuted = true
      const answer: any = String(await rl.question('')).trim()
      rl.output.write('\n')
      if (!required || answer) return answer
    }
  } finally {
    rl.stdoutMuted = false
    rl.close()
  }
}
