#!/usr/bin/env node
/**
 * 构建 lib/client.js：把 client-src/ 打包成 DSH 客户端 bundle。
 *
 * 产物契约（与官方 @deepseek-ai/dsh-client-ui-* 一致）：
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ...; return module.exports } })
 * react 由 DSH 客户端运行时通过 require 提供，保持 external。
 */

import esbuild from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

await esbuild.build({
  entryPoints: [join(root, 'client-src/index.js')],
  outfile: join(root, 'lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  charset: 'utf8',
  external: ['react'],
  legalComments: 'none',
  banner: {
    js: [
      'window.__ModuleLoader__.load({',
      '  id: "dsh-feishu-integration",',
      '  factory: (require) => {',
      '    var module = { exports: {} };',
      '    var exports = module.exports;',
    ].join('\n'),
  },
  footer: {
    js: '\n    return module.exports;\n  }\n});',
  },
  logLevel: 'info',
})
