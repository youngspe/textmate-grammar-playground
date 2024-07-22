import * as plist from 'fast-plist'
import { LanguageRegistration, RawGrammar, RawTheme, RawThemeSetting } from 'shiki'
import { Writable } from './utils'
import * as yaml from 'yaml'

function parseSource(source: string): any {
    if (source.startsWith('<')) {
        return plist.parse(source)
    } else if (source.startsWith('{')) {
        return JSON.parse(source)
    } else {
        return yaml.parse(source, { merge: true })
    }
}

function convertTheme(theme: any): RawTheme {
    if ('settings' in theme) {
        return theme
    }
    if ('tokenColors' in theme) {
        const outTheme: Writable<RawTheme> = {
            settings: theme.tokenColors ?? []
        }

        if ('colors' in theme) {
            const colors = theme.colors
            let globalSettings: Writable<RawThemeSetting['settings']> | null = null

            if (colors['editor.foreground']) {
                (globalSettings ??= {}).foreground = colors['editor.foreground']
            }

            if (colors['editor.background']) {
                (globalSettings ??= {}).background = colors['editor.background']
            }

            if (globalSettings) {
                outTheme.settings?.splice(0, 0, { settings: globalSettings })
            }
        }

        if ('name' in theme) {
            outTheme.name = theme.name
        }

        return outTheme
    }

    throw new Error('invalid theme')
}

export function getTheme(source: string): RawTheme | null {
    source = source.trimStart()

    if (source == '') return null

    return convertTheme(applyVariables(parseSource(source)))
}

export function getGrammar(source: string): LanguageRegistration | null {
    source = source.trimStart()
    if (source == '') return null
    const parsed: Partial<LanguageRegistration> = parseSource(source)
    return applyVariables(parsed as LanguageRegistration)
}

const VARIABLE_REGEX = /\{\{\s*?([\w-]*?)\s*?\}\}/gim

function replaceVariables(src: string, variables: Record<string, string>): string {
    return src.replace(VARIABLE_REGEX, (_, v) => {
        if (v in variables) return variables[v]
        throw new Error(`unknown variable '${v}'`)
    })
}

function getVariables(root: { variables?: Record<string, string> }): Record<string, string> | null {
    const variables = root.variables
    if (!variables) return null
    delete root.variables


    for (const varName in variables) {
        variables[varName] = replaceVariables(variables[varName], variables)
    }

    return variables
}

function replaceAllVariables<T>(target: T, variables: Record<string, string>): T {
    if (target == null) return target
    switch (typeof target) {
        case 'string': return replaceVariables(target, variables) as T
        case 'object':
            for (const key in target) {
                target[key] = replaceAllVariables(target[key], variables)
            }
            return target

        default: return target
    }
}

function applyVariables<T extends object>(target: T): Omit<T, 'variables'> {
    const variables = getVariables(target)
    if (variables) {
        replaceAllVariables(target, variables)
    }
    return target
}
