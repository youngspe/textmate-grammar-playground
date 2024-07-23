import { BundledTheme, bundledThemes, createdBundledHighlighter, FontStyle, LanguageRegistration, loadWasm, RawGrammar, setDefaultWasmLoader, ThemeInput, ThemeRegistration, TokensResult } from 'shiki'
import * as rx from 'rxjs'
import { getGrammar, getTheme } from './tmAsset'
import { Writable } from './utils'
import { langNames, themeNames } from './generated/assetNames'
import { debounceNow, observeEvent } from './utils/rx'
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

const subscribeTextContent = (
    src: rx.Observable<string | null>,
    element: HTMLElement,
) => subscribeProperty(
    src,
    element,
    'textContent',
    (value, element) => value != null && value !== element.innerText
)


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
                fg, bg, accent, tabFg, tabBg, border, selectFg, selectBg, dark
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
                store.rootStyle = root.style.cssText
            }),
        )
        return this._sub
    }

    loaded({
        grammarInput,
        codeInput,
        themeInput,
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
                .pipe(rx.map(({ target }) => target.innerText ?? ''))
                .subscribe(viewModel.grammar),
            observeEvent()
                .when(codeInput, 'input')
                .pipe(rx.map(({ target }) => target.innerText ?? ''))
                .subscribe(viewModel.code),
            observeEvent()
                .when(themeInput, 'input')
                .pipe(rx.map(({ target }) => target.innerText ?? ''))
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
            subscribeTextContent(viewModel.grammar, grammarInput),
            subscribeTextContent(viewModel.code, codeInput),
            subscribeTextContent(viewModel.theme, themeInput),
            subscribeProperty(viewModel.langPreset, langSelect, 'value', null),
            subscribeProperty(viewModel.themePreset, themeSelect, 'value', null),
        )

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

function overrideTabBehavior<T extends HTMLElement>(target: T, tabString: Reference<string>): T {
    const _target: typeof target & { [_isEditing]?: boolean } = target
    _target.addEventListener('keydown', e => {
        if (e.key == 'Tab' && _target[_isEditing]) {
            const selection = document.getSelection()
            if (!selection) return
            if (selection.rangeCount != 1) return
            if (!_target.contains(selection.anchorNode) || !_target.contains(selection.focusNode)) return
            const { focusNode } = selection
            selection.getRangeAt(0).deleteContents()
            const tab = tabString.value
            if (focusNode instanceof Text) {
                focusNode.replaceData(selection.focusOffset, 0, tab)
                selection.setPosition(focusNode, selection.focusOffset + tab.length)
            } else if (focusNode instanceof HTMLElement) {
                const newNode = new Text(tab)
                if (focusNode.firstChild instanceof HTMLElement && focusNode.firstChild.tagName == 'BR') {
                    focusNode.firstChild.replaceWith(newNode)
                } else {
                    focusNode.prepend(newNode)
                }
                selection.setPosition(newNode, tab.length)
            }
            _target.dispatchEvent(new Event('input'))
            e.preventDefault()
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

    grammarInput: HTMLElement,
    codeInput: HTMLElement,
    themeInput: HTMLElement,
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
viewModel.begin({ store })
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
        grammarInput: overrideTabBehavior(document.getElementById('grammar-in')!, tabString),
        codeInput: overrideTabBehavior(document.getElementById('code-in')!, tabString),
        themeInput: overrideTabBehavior(document.getElementById('theme-in')!, tabString),
        outputView: document.getElementById('output')!,
        langSelect: document.getElementById('select-lang') as HTMLSelectElement,
        themeSelect: document.getElementById('select-theme') as HTMLSelectElement,
        viewModel,
    })
}

{ (global as any)._initScript = initialize }
