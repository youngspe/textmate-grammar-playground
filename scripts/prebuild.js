const fs = require('node:fs/promises')
const path = require('node:path')
const { webpack } = require('webpack')
const webpackConfig = require('../webpack.config')

const cwd = path.dirname(__dirname)
const langsSrc = path.join(cwd, 'node_modules/tm-grammars/grammars/')
const themesSrc = path.join(cwd, 'node_modules/tm-themes/themes/')
const distPath = path.join(cwd, 'dist/')
const langsPath = path.join(distPath, 'langs/')
const themesPath = path.join(distPath, 'themes/')

/**
 *
 * @param {string} path
 * @param {string} ext
 * @returns {Promise<string[]>}
 */
async function getFileNames(path, ext) {
    const dir = await fs.readdir(path)
    return dir.flatMap(name => name.endsWith(ext) ? [name.slice(0, -ext.length)] : [])
}

async function main() {
    const dirOpts = { recursive: true }
    await fs.mkdir(distPath, dirOpts)


    await Promise.all([
        fs.cp(path.join(cwd, 'public/'), distPath, dirOpts),
        (async () => {
            await fs.mkdir(langsPath, dirOpts)
            await fs.cp(langsSrc, langsPath, dirOpts)
        })(),
        (async () => {
            await fs.mkdir(themesPath, dirOpts)
            await fs.cp(themesSrc, themesPath, dirOpts)
        })(),
        (async () => {
            const langNames = getFileNames(langsSrc, '.json')
            const themeNames = getFileNames(themesSrc, '.json')

            await fs.writeFile(path.join(cwd, 'src/generated/assetNames.ts'), `
export const langNames = ${JSON.stringify(await langNames)} as const;
export const themeNames = ${JSON.stringify(await themeNames)} as const;
`)
        })(),
        new Promise(ok => webpack(webpackConfig, ok)),
    ])
}
main()
