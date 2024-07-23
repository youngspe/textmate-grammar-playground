import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { Writable } from 'node:stream'
import path from 'node:path'
import webpack from 'webpack'
const webpackConfig = require('../webpack.config') as webpack.Configuration


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
async function getFileNames(path: string, ext: string) {
    const dir = await fs.readdir(path)
    return dir.flatMap(name => name.endsWith(ext) ? [name.slice(0, -ext.length)] : [])
}

const dirOpts = { recursive: true }

const TYPESCRIPT_GRAMMAR_URL = 'https://raw.githubusercontent.com/microsoft/TypeScript-TmLanguage/master/TypeScript.YAML-tmLanguage'
const MINTYML_GRAMMAR_URL = 'https://raw.githubusercontent.com/youngspe/mintyml-vscode/main/syntaxes/mintyml.tmLanguage.yaml'

async function copyFilesStripExtensions(srcDir: string, destDir: string) {
    const files = fs.readdir(srcDir)
    await fs.mkdir(destDir, dirOpts)
    await Promise.all((await files).map(src => fs.copyFile(
        path.join(srcDir, src),
        path.join(destDir, src.replace(/(?:\..*)+$/, ''))
    )))
}

async function saveUrl(url: string, filePath: string) {
    let file: fs.FileHandle | undefined
    try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(res.statusText)
        if (!res.body) throw new Error('No response body')
        await res.body.pipeTo(Writable.toWeb(createWriteStream(filePath)))
    } catch (e) {
        console.error()
        await file?.close()
    }
}

async function main() {
    await fs.mkdir(distPath, dirOpts)

    await Promise.all([
        fs.cp(path.join(cwd, 'public/'), distPath, dirOpts),
        copyFilesStripExtensions(langsSrc, langsPath)
            .then(() => Promise.all([
                saveUrl(TYPESCRIPT_GRAMMAR_URL, path.join(langsPath, 'typescript')),
                saveUrl(MINTYML_GRAMMAR_URL, path.join(langsPath, 'mintyml')),
            ])),
        copyFilesStripExtensions(themesSrc, themesPath),
        (async () => {
            const langNames = getFileNames(langsSrc, '.json')
            const themeNames = getFileNames(themesSrc, '.json')

            await fs.writeFile(path.join(cwd, 'src/generated/assetNames.ts'), `
export const langNames = ${JSON.stringify([...await langNames, 'mintyml'])} as const;
export const themeNames = ${JSON.stringify(await themeNames)} as const;
`)
        })(),
        new Promise(ok => webpack(webpackConfig, ok)),
    ])
}

main()
