import {cpus, freemem, totalmem, uptime} from 'node:os';
import {readFileSync} from 'node:fs';

function cpuSample() {
  const cores = cpus();
  return {cores: cores.length, idle: cores.reduce((sum, core) => sum + core.times.idle, 0),
    total: cores.reduce((sum, core) => sum + Object.values(core.times).reduce((a, b) => a + b, 0), 0)};
}
function memorySample() {
  const total = totalmem();
  let available = freemem();
  if (process.platform === 'linux') {
    try {
      // Available includes reclaimable cache; free alone overstates Linux memory use.
      const match = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+) kB$/m);
      if (match) available = Number(match[1]) * 1024;
    } catch { /* Fall back to the OS API if procfs is unavailable. */ }
  }
  return {total, available};
}
export function createStatusReader({provider = 'local', readCpu = cpuSample,
  readMemory = memorySample, now = Date.now, readUptime = uptime, cacheMs = 5000} = {}) {
  let previous = readCpu();
  let cached;
  let sampledAt = -Infinity;
  return () => {
    const timestamp = now();
    if (cached && timestamp - sampledAt < cacheMs) return cached;
    const current = readCpu();
    const delta = current.total - previous.total;
    const cpuPercent = delta > 0 ? Math.max(0, Math.min(100,
      (1 - (current.idle - previous.idle) / delta) * 100)) : null;
    previous = current;
    const memory = readMemory();
    const used = Math.max(0, Math.min(memory.total, memory.total - memory.available));
    sampledAt = timestamp;
    cached = {provider, sampledAt: new Date(timestamp).toISOString(), cpu: {
      cores: current.cores, percent: cpuPercent === null ? null : Math.round(cpuPercent * 10) / 10,
    }, memory: {totalBytes: memory.total, usedBytes: used,
      percent: memory.total > 0 ? Math.round(used / memory.total * 1000) / 10 : null},
    uptimeSeconds: Math.floor(readUptime())};
    return cached;
  };
}
