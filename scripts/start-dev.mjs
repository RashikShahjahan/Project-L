import { spawn } from 'node:child_process'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const commands = ['run server:dev', 'run dev']
const children = commands.map((args) => spawn(npm, args.split(' '), {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  detached: process.platform !== 'win32',
}))

let stopping = false

function stop(signal = 'SIGTERM', exitCode = 0) {
  if (stopping) return
  stopping = true
  process.exitCode = exitCode

  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal)
      else child.kill(signal)
    } catch {
      // The child may have exited between the status check and the signal.
    }
  }
}

for (const child of children) {
  child.on('error', (error) => {
    console.error('Could not start a development process:', error)
    stop('SIGTERM', 1)
  })
  child.on('exit', (code, signal) => {
    if (!stopping) stop('SIGTERM', code ?? (signal ? 1 : 0))
  })
}

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
