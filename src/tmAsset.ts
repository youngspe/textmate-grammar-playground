import * as plist from 'fast-plist'
import { LanguageRegistration, RawGrammar, RawTheme, RawThemeSetting, ThemeRegistrationAny } from 'shiki'
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

function convertTheme(theme: any): ThemeRegistrationAny {
    if (theme === null || typeof theme !== 'object') throw new Error(`invalid theme: ${theme}`)
    if (!('settings' in theme) && !('tokenColors' in theme)) throw new Error('invalid theme')
    return theme
}

export function getTheme(source: string): ThemeRegistrationAny | null {
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

export function getScopeSetting(theme: ThemeRegistrationAny, scope: string, setting: string): string | null {
    let bestLength = 0
    let settingValue: string | null = null
    for (const current of theme.settings ?? theme.tokenColors ?? []) {
        if (!current.settings || typeof current.settings !== 'object' || !(setting in current.settings)) continue
        let currentScope = ''
        if (current.scope instanceof Array) {
            currentScope = current.scope.reduce((best, current) => (
                current.length > bestLength
                    && current.length > best.length
                    && scope.startsWith(current)
                    && (scope.at(current.length) ?? '.') === '.' ?
                    current :
                    best
            ), currentScope)
        } else if (current.scope && current.scope.length > bestLength && scope.startsWith(current.scope)) {
            currentScope = current.scope
        }

        if (currentScope.length === scope.length) return (current.settings as any)[setting]

        if (currentScope.length > bestLength) {
            bestLength = currentScope.length
            settingValue = (current.settings as any)[setting]
        }
    }
    return settingValue
}
