import {isIP, BlockList} from 'node:net';
import geoip from 'geoip-lite';

const localNetworks = new BlockList();
for (const [address, prefix] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16],
  ['169.254.0.0', 16], ['100.64.0.0', 10], ['0.0.0.0', 8]]) {
  localNetworks.addSubnet(address, prefix, 'ipv4');
}
localNetworks.addSubnet('fc00::', 7, 'ipv6');
localNetworks.addSubnet('fe80::', 10, 'ipv6');
const countries = new Intl.DisplayNames(['zh-CN'], {type: 'region'});

export function normalizeIp(address) {
  const value = String(address || '').replace(/^::ffff:/i, '').toLowerCase();
  return isIP(value) ? value : '';
}

export function locateIp(address, lookup = geoip.lookup) {
  const ip = normalizeIp(address);
  if (!ip) return {location: '未知来源', locationType: 'unknown'};
  if (ip === '::1' || ip.startsWith('127.')) {
    return {location: '本机访问', locationType: 'local'};
  }
  if (ip === '::' || localNetworks.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4')) {
    return {location: '内网访问', locationType: 'private'};
  }
  const geo = lookup(ip);
  if (!geo?.country) return {location: '归属地未知', locationType: 'unknown'};
  const country = /^[A-Z]{2}$/.test(geo.country) ? countries.of(geo.country) : geo.country;
  // IP databases provide approximate network locations, never a person's GPS position.
  return {location: [country, geo.region, geo.city].filter(Boolean).join(' · '), locationType: 'estimated'};
}

export function describeAgent(value) {
  const ua = String(value || '').slice(0, 512);
  const browser = /Edg(?:e|A|iOS)?\//.test(ua) ? 'Edge' : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox' :
    /OPR\//.test(ua) ? 'Opera' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' :
      /Safari\//.test(ua) ? 'Safari' : '未知浏览器';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' :
    /Windows/.test(ua) ? 'Windows' : /Macintosh|Mac OS X/.test(ua) ? 'macOS' :
      /Linux/.test(ua) ? 'Linux' : '未知系统';
  const device = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? '平板' :
    /Mobile|iPhone|iPod/.test(ua) ? '手机' : os === '未知系统' ? '未知设备' : '电脑';
  return {browser, os, device};
}

export function readClientInfo(request) {
  const ip = normalizeIp(request.ip || request.socket.remoteAddress);
  return {ip, ...locateIp(ip), ...describeAgent(request.get('user-agent'))};
}
