import { FontStyle, LanguageRegistration, TokensResult } from 'shiki'
import * as rx from 'rxjs'
import { langNames, themeNames } from './generated/assetNames'
import { observeEvent } from './utils/rx'
import { storageObject } from './store'
import { GrammarPlaygroundViewModel } from './viewModel'
import { el } from './utils/dom'


const nodeScopes = Symbol('nodeScopes')

interface NodeWithScopes extends Node {
    [nodeScopes]?: string[]
}

const subscribeProperty = <T extends Target[Prop], Target, Prop extends keyof Target>(
    src: rx.Observable<T>,
    target: Target,
    prop: keyof Target,
    condition: undefined | null | ((value: T, target: Target) => boolean) = (value, target) => value != target[prop],
) => src.subscribe(value => {
    if (!condition || condition(value, target)) {
        target[prop] = value
    }
})

class GrammarPlaygroundView {
    private _outputView?: HTMLElement

    private readonly _sub = new rx.Subscription()
    private _onTokenFocus
    private _onTokenBlur
    private viewModel?: GrammarPlaygroundViewModel

    constructor() {
        const _this = this
        this._onTokenFocus = function (this: NodeWithScopes) {
            _this.viewModel?.scopes.next(this[nodeScopes] ?? null)
        }
        this._onTokenBlur = function (this: NodeWithScopes) {
            _this.viewModel?.scopes.next(null)
        }
    }

    private sub(...teardown: rx.TeardownLogic[]) {
        for (const item of teardown) {
            this._sub.add(item)
        }
    }

    begin({
        root,
        store,
    }: BeginArgs): rx.Subscription {
        if (store.rootStyle) {
            root.style.cssText = store.rootStyle
        }

        this.sub(
            viewModel
                .tokens
                .pipe(rx.filter(t => t != null))
                .subscribe(t => this.updateHighlights(t)),
            viewModel.colors.subscribe(({
                fg, bg, accent, tabFg, tabBg, border, selectFg, selectBg, dark, errorFg, errorBg,
            }) => {
                root.style.cssText = ''
                if (fg) { root.style.setProperty('--fg', fg) }
                if (bg) { root.style.setProperty('--bg', bg) }
                if (accent) { root.style.setProperty('--accent-color', accent) }
                if (tabFg) { root.style.setProperty('--tab-fg', tabFg) }
                if (tabBg) { root.style.setProperty('--tab-bg', tabBg) }
                if (border) { root.style.setProperty('--border-color', border) }
                if (selectFg) { root.style.setProperty('--select-fg', selectFg) }
                if (selectBg) { root.style.setProperty('--select-bg', selectBg) }
                if (dark != null) { root.style.setProperty('color-scheme', dark ? 'dark' : 'light') }
                if (errorFg) { root.style.setProperty('--error-fg', errorFg) }
                if (errorBg) { root.style.setProperty('--error-bg', errorBg) }
                store.rootStyle = root.style.cssText
            }),
        )
        return this._sub
    }

    loaded({
        grammarInput,
        codeInput,
        themeInput,
        grammarError,
        themeError,
        outputView,
        langSelect,
        themeSelect,
        viewModel,
    }: LoadedArgs): void {
        this.viewModel = viewModel

        langSelect.append(...langNames.map(value => el('option', { value }, [value])))
        themeSelect.append(...themeNames.map(value => el('option', { value }, [value])))

        this.sub(
            observeEvent()
                .when(grammarInput, 'input')
                .pipe(rx.map(({ target }) => target.value))
                .subscribe(viewModel.grammar),
            observeEvent()
                .when(codeInput, 'input')
                .pipe(rx.map(({ target }) => target.value))
                .subscribe(viewModel.code),
            observeEvent()
                .when(themeInput, 'input')
                .pipe(rx.map(({ target }) => target.value))
                .subscribe(viewModel.theme),
            observeEvent()
                .when(langSelect, 'input')
                .pipe(rx.map(e => e.target.value))
                .subscribe(viewModel.langPreset),
            observeEvent()
                .when(themeSelect, 'input')
                .pipe(rx.map(e => e.target.value))
                .subscribe(viewModel.themePreset),
            observeEvent()
                .when(grammarInput, 'input')
                .subscribe(() => {
                    viewModel.langPreset.next(langSelect.value = '')
                }),
            observeEvent()
                .when(themeInput, 'input')
                .subscribe(() => {
                    viewModel.themePreset.next(themeSelect.value = '')
                }),
            subscribeProperty(viewModel.grammar, grammarInput, 'value'),
            subscribeProperty(viewModel.code, codeInput, 'value'),
            subscribeProperty(viewModel.theme, themeInput, 'value'),
            subscribeProperty(viewModel.langPreset, langSelect, 'value', null),
            subscribeProperty(viewModel.themePreset, themeSelect, 'value', null),
        )

        const setupErrorView = (view: HTMLElement, key: keyof typeof viewModel.errors) => {
            const errorTextView = el('span', { className: 'status-text' })
            const button = el('button', { className: 'close-button', type: 'button' }, ['close'])
            view.replaceChildren(errorTextView, button)

            function updateWithError(error: Error | null) {
                errorTextView.innerText = error ? error.toString() : ''
                view.hidden = error == null
            }

            button.addEventListener('click', () => { updateWithError(null) })

            this.sub(
                viewModel.errors[key].pipe(rx.distinctUntilChanged((a, b) => a == b || a?.toString() == b?.toString())).subscribe(updateWithError),
                () => { view.replaceChildren() },
            )
        }

        setupErrorView(grammarError, 'lang')
        setupErrorView(themeError, 'theme')

        {
            const pre = el('pre')
            const info = el('footer', {
                className: 'info',
            })
            outputView.replaceChildren(pre, info)

            this.sub(viewModel.scopes.subscribe(scopes => {
                info.replaceChildren(...scopes?.map((scope) => el('div', [scope])) ?? ['Select a token above to see its scopes'])
            }))
            this._outputView = pre
        }

        {
            const media = window.matchMedia('(prefers-color-scheme: dark)')
            viewModel.isDark.next(media.matches)
            this._sub.add(observeEvent()
                .when(media, 'change')
                .pipe(rx.map(({ target }) => target.matches))
                .subscribe(viewModel.isDark))
        }
    }

    updateHighlights({ tokens, fg, bg }: TokensResult) {
        if (fg) this._outputView!.style.color = fg
        if (bg) this._outputView!.style.background = bg

        this._outputView!.replaceChildren(...tokens.map(tokens => {
            const row = el('div', { className: 'line' }, tokens.map(({
                content, color, explanation = [], fontStyle, htmlStyle, bgColor,
            }) => {
                let span: HTMLSpanElement & NodeWithScopes
                if (explanation.length > 1) {
                    const children: Node[] = []
                    let i = 0
                    for (const exp of explanation) {
                        const end = i + exp.content.length
                        const scopes = exp.scopes.map(s => s.scopeName).reverse()
                        const span: HTMLSpanElement & NodeWithScopes = el('span', {
                            title: scopes.join('\n'),
                            className: 'token',
                            // Make it focusable:
                            tabIndex: 0,
                        }, [content.slice(i, end)])
                        span.addEventListener('focus', this._onTokenFocus)
                        span.addEventListener('blur', this._onTokenBlur)
                        span[nodeScopes] = scopes
                        children.push(span)
                        i = end
                    }
                    span = el('span', {}, children)
                } else {
                    span = el('span', {
                        className: 'token',
                        tabIndex: 0,
                    }, [content])
                    span[nodeScopes] = explanation.flatMap(e => e.scopes.map(s => s.scopeName)).reverse()
                    span.title = span[nodeScopes].join('\n')
                    span.addEventListener('focus', this._onTokenFocus)
                    span.addEventListener('blur', this._onTokenBlur)
                }
                if (htmlStyle != null) {
                    span.style.cssText = htmlStyle
                } else {
                    if (color) span.style.color = color
                    if (bgColor) span.style.backgroundColor = bgColor
                    if (fontStyle && fontStyle > 0) {
                        if (fontStyle & FontStyle.Italic) span.style.fontStyle = 'italic'
                        if (fontStyle & FontStyle.Bold) span.style.fontWeight = 'bold'
                        if (fontStyle & FontStyle.Underline) span.style.textDecoration = 'solid underline'
                    }
                }
                return span
            }))
            return row
        }))
    }
}

const _isEditing = Symbol('isEditing')

interface Reference<T> {
    value: T
}

function overrideTabBehavior<T extends HTMLTextAreaElement>(target: T, tabString: Reference<string>): T {
    const _target: typeof target & { [_isEditing]?: boolean } = target
    _target.addEventListener('keydown', e => {
        if (!_target[_isEditing] || e.metaKey || e.ctrlKey || e.altKey) return
        if (e.key == 'Tab') {
            const start = _target.selectionStart
            const end = _target.selectionEnd
            const lineStart = target.value.lastIndexOf('\n', start) + 1
            const tab = tabString.value

            let newSubString: string
            let tempStart: number | undefined
            let newStart: number | undefined

            if (e.shiftKey) {
                tempStart = lineStart
                newSubString = _target.value.slice(lineStart, end).replace(new RegExp(`^${tab}`, 'gm'), '')
                newStart = Math.max(start - tab.length, lineStart)
            } else if (start === end) {
                const sliceStart = (start - lineStart) % tab.length
                newSubString = tab.slice(sliceStart)
                newStart = start + tab.length - sliceStart
            } else {
                tempStart = lineStart
                newSubString = _target.value.slice(lineStart, end).replace(/^(?!$)/gm, tab)
                newStart = start === lineStart ? lineStart : start + tab.length
                _target.selectionStart = lineStart
            }

            if (tempStart != null) { _target.selectionStart = tempStart }

            const execCommandSuccess =
                typeof document.execCommand === 'function'
                && document.execCommand('insertText', false, newSubString)

            if (!execCommandSuccess) {
                _target.setRangeText(newSubString)
            }

            if (newStart != null) { _target.selectionStart = newStart }

            e.preventDefault()
            _target.dispatchEvent(new InputEvent('input'))
        } else if (e.key == 'Escape') {
            _target[_isEditing] = false
            _target.blur()
        }
    })
    _target.addEventListener('click', () => {
        _target[_isEditing] = true
    })
    _target.addEventListener('input', () => {
        _target[_isEditing] = true
    })
    _target.addEventListener('blur', () => {
        _target[_isEditing] = false
    })
    return target
}

interface BeginArgs {
    root: HTMLElement,
    store: Record<(
        | 'rootStyle'
    ), string | null>,
}

interface LoadedArgs {

    grammarInput: HTMLTextAreaElement,
    codeInput: HTMLTextAreaElement,
    themeInput: HTMLTextAreaElement,
    grammarError: HTMLElement,
    themeError: HTMLElement,
    outputView: HTMLElement,
    langSelect: HTMLSelectElement,
    themeSelect: HTMLSelectElement,
    viewModel: GrammarPlaygroundViewModel,
}

const viewModel = new GrammarPlaygroundViewModel()
const view = new GrammarPlaygroundView()

const APP_STORAGE_KEY = 'app.grammar-playground'

const STORE_KEYS = {
    grammar: `${APP_STORAGE_KEY}/input.grammar`,
    code: `${APP_STORAGE_KEY}/input.code`,
    theme: `${APP_STORAGE_KEY}/input.theme`,
    langPreset: `${APP_STORAGE_KEY}/preset.lang`,
    themePreset: `${APP_STORAGE_KEY}/preset.theme`,
    tabValue: `${APP_STORAGE_KEY}/settings.tabValue`,
    rootStyle: `${APP_STORAGE_KEY}/cache.rootStyle`,
} as const

const root = document.querySelector('html')!

const store = storageObject(sessionStorage, STORE_KEYS)
const baseUrl = (global as any)._appBaseUrl ?? ''
viewModel.begin({ store, baseUrl })
view.begin({ root, store })

const initialize = () => {
    function getTabString(input: string): string | null {
        if (input == 'tab') return '\t'
        const num = Number(input)
        if (num > 0) return ' '.repeat(num)
        return null
    }

    const tabString = { value: getTabString(store.tabValue ??= '4') ?? '    ' }
    const tabSelect = document.getElementById('select-tab') as HTMLSelectElement
    tabSelect.value = store.tabValue

    tabSelect.addEventListener('input', () => {
        const s = getTabString(tabSelect.value)
        store.tabValue = tabSelect.value
        if (s) { tabString.value = s }
    })

    view.loaded({
        grammarInput: overrideTabBehavior(document.getElementById('grammar-in') as HTMLTextAreaElement, tabString),
        codeInput: overrideTabBehavior(document.getElementById('code-in') as HTMLTextAreaElement, tabString),
        themeInput: overrideTabBehavior(document.getElementById('theme-in') as HTMLTextAreaElement, tabString),
        grammarError: document.getElementById('grammar-error')!,
        themeError: document.getElementById('theme-error')!,
        outputView: document.getElementById('output')!,
        langSelect: document.getElementById('select-lang') as HTMLSelectElement,
        themeSelect: document.getElementById('select-theme') as HTMLSelectElement,
        viewModel,
    })
}

{ (global as any)._initScript = initialize }
