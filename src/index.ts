import { BundledTheme, bundledThemes, createdBundledHighlighter,  FontStyle, LanguageRegistration, loadWasm, RawGrammar, setDefaultWasmLoader, ThemeInput, ThemeRegistration, TokensResult } from 'shiki'
import * as rx from 'rxjs'
import { getGrammar, getTheme } from './tmAsset'
import { Writable } from './utils'
import { langNames, themeNames } from './generated/assetNames'


const catcher = <T>() => rx.catchError<T, rx.Observable<T>>((e, rest) => {
    console.error(e)
    return rest
})

const cleanup = <T>(f: (previous: T) => void) => rx.scan<T>((acc, item) => {
    f(acc)
    return item
})

module DelayState {
    export const Ready = Symbol('ready')
    export const Delaying = Symbol('delaying')
}

type DelayState<T> = (typeof DelayState)[keyof typeof DelayState] | T

const debounceNow = <T>(
    interval: number,
    scheduler: rx.SchedulerLike = rx.asyncScheduler,
) => (src: rx.Observable<T>) => new rx.Observable<T>(out => {
    let state: DelayState<T> = DelayState.Ready

    out.add(src.subscribe({
        complete: out.complete.bind(out),
        error: out.error.bind(out),
        next(value) {
            if (state === DelayState.Ready) {
                out.next(value)
                state = DelayState.Delaying
                out.add(scheduler.schedule(function () {
                    if (state === DelayState.Delaying) {
                        state = DelayState.Ready
                    } else if (state !== DelayState.Ready) {
                        out.next(state)
                        this.schedule(undefined, interval)
                        state = DelayState.Delaying
                    }
                }, interval))
            } else {
                state = value
            }
        },
    }))
})

const HIGHLIGHT_DEBOUNCE_TIME = 50
const REBUILD_DEBOUNCE_TIME = 2_000
const STORAGE_DEBOUCE_TIME = 4_000

type ElementForTag<Tag extends string> = Tag extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[Tag] : HTMLElement

function el<Tag extends keyof HTMLElementTagNameMap | string>(
    tag: Tag,
    ...[attrs, content]: [
        ...attrs: [Partial<ElementForTag<Tag>>] | [],
        ...content: [(string | Node)[]] | [],
    ]
): ElementForTag<Tag> {
    const element = document.createElement(tag)

    if (attrs instanceof Array) {
        content = attrs
        attrs = undefined
    }

    if (attrs) {
        Object.assign(element, attrs)
    }
    if (content) {
        element.append(...content)
    }
    return element as ElementForTag<Tag>
}

interface TypedEventTarget<This, Map extends object> {
    addEventListener<K extends keyof Map>(this: This, name: K, listener: (this: This, event: Map[K]) => void): void
    removeEventListener<K extends keyof Map>(this: This, name: K, listener: (this: This, event: Map[K]) => void): void
}

interface SingleEventTarget<This, K extends PropertyKey, E> {
    addEventListener(this: This, name: K, listener: (this: This, event: E) => void): void
    removeEventListener(this: This, name: K, listener: (this: This, event: E) => void): void
}

type ObserveEventConstructor<Map> = abstract new (map: Map) => any

function observeEvent<Map extends object = HTMLElementEventMap>() {
    return {
        when<
            K extends keyof Map,
            Target extends TypedEventTarget<Target, Map> | SingleEventTarget<Target, K, Map[K]>,
        >(target: Target, name: K): rx.Observable<{ target: Target, event: Map[K] }> {
            return new rx.Observable(s => {
                function listener(this: Target, event: Map[K]) {
                    s.next({ target: this, event })
                }
                (target as Target).addEventListener(name, listener)
                return () => {
                    (target as Target).removeEventListener(name, listener)
                }
            })
        }
    }
}

const LIGHT_THEME = 'solarized-light' satisfies BundledTheme
const DARK_THEME = 'solarized-dark' satisfies BundledTheme
const CUSTOM_THEME = '-custom-theme'
const CUSTOM_LANG = '-custom-lang'

const nodeScopes = Symbol('nodeScopes')

interface NodeWithScopes extends Node {
    [nodeScopes]?: string[]
}

class GrammarPlayground {
    private _grammarInput?: HTMLElement
    private _themeInput?: HTMLElement
    private _outputView?: HTMLElement

    private _grammar = new rx.Subject<string>()
    private _code = new rx.Subject<string>()
    private _theme = new rx.Subject<string>()
    private _langPreset = new rx.Subject<string>()
    private _themePreset = new rx.Subject<string>()
    private _isDark = new rx.Subject<boolean>()
    private _scopes = new rx.Subject<string[]>()
    private _updateEvent
    private readonly _sub = new rx.Subscription()
    private _onTokenFocus
    private _onTokenBlur
    private _signal

    constructor() {
        {
            const controller = new AbortController()
            this._signal = controller.signal
            this._sub.add(() => controller.abort())
        }

        const grammar = this._grammar
            .pipe(debounceNow(REBUILD_DEBOUNCE_TIME))
            .pipe(rx.distinctUntilChanged())
            .pipe(rx.map(source => {
                const grammar: Writable<LanguageRegistration> | null = getGrammar(source)
                if (!grammar) throw new Error('No grammar provided')
                return Object.assign(grammar, { name: CUSTOM_LANG } as const)
            }))
            .pipe(catcher())

        const theme = this._theme
            .pipe(debounceNow(REBUILD_DEBOUNCE_TIME))
            .pipe(rx.distinctUntilChanged())
            .pipe(rx.map(source => {
                const theme = getTheme(source)
                return theme && Object.assign(theme, { name: CUSTOM_THEME } as const)
            }))
            .pipe(catcher())

        const highlighter = rx.combineLatest({
            grammar, theme,
        }).pipe(rx.switchMap(async ({ grammar, theme }) => {
            const themes = {
                [DARK_THEME]: bundledThemes[DARK_THEME],
                [LIGHT_THEME]: bundledThemes[LIGHT_THEME],
                [CUSTOM_THEME]: theme ?? { name: CUSTOM_THEME },
            }
            return {
                highlighter: await createdBundledHighlighter({ [CUSTOM_LANG]: grammar }, themes, () => import('shiki/wasm'))({
                    langs: [CUSTOM_LANG],
                    themes: Object.keys(themes),
                }), theme
            }
        }), cleanup(({ highlighter }) => highlighter.dispose()))

        const tokens = rx.combineLatest({
            highlighter,
            isDark: this._isDark,
            code: this._code.pipe(rx.distinctUntilChanged())
        })
            .pipe(debounceNow(HIGHLIGHT_DEBOUNCE_TIME))
            .pipe(rx.map(({ highlighter: { theme, highlighter }, code, isDark }) => highlighter.codeToTokens(code, {
                lang: CUSTOM_LANG,
                theme: theme ? CUSTOM_THEME : isDark ? DARK_THEME : LIGHT_THEME,
                includeExplanation: true,
            })))

        this._updateEvent = tokens

        {
            const scopes = this._scopes
            this._onTokenFocus = function (this: NodeWithScopes) {
                scopes.next(this[nodeScopes] ?? [])
            }
            this._onTokenBlur = function (this: NodeWithScopes) {
                scopes.next([])
            }
        }
    }

    private setGrammar(value: string) {
        this._grammar.next(value)
        this._grammarInput!.textContent = value
    }

    private setTheme(value: string) {
        this._theme.next(value)
        this._themeInput!.textContent = value
    }

    private async loadGrammar(value: string) {
        this._langPreset.next(value)
        const text = await fetch(`/langs/${value}.json`, { signal: this._signal }).then(res => res.text())
        this.setGrammar(text)
    }

    private async loadTheme(value: string) {
        this._themePreset.next(value)
        const text = await fetch(`/themes/${value}.json`, { signal: this._signal }).then(res => res.text())
        this.setTheme(text)
    }

    private sub(...teardown: rx.TeardownLogic[]) {
        for (const item of teardown) {
            this._sub.add(item)
        }
    }

    begin({
        grammarInput,
        codeInput,
        themeInput,
        outputView,
        langSelect,
        themeSelect,
        store,
    }: BeginArgs) {
        this.sub(
            this._updateEvent
                .pipe(catcher())
                .subscribe(e => this.updateHighlights(e)),
            observeEvent()
                .when(grammarInput, 'input')
                .pipe(rx.map(({ target }) => target.innerText ?? ''))
                .subscribe(this._grammar),
            observeEvent()
                .when(codeInput, 'input')
                .pipe(rx.map(({ target }) => target.innerText ?? ''))
                .subscribe(this._code),
            observeEvent()
                .when(themeInput, 'input')
                .pipe(rx.map(({ target }) => target.innerText ?? ''))
                .subscribe(this._theme),
            observeEvent()
                .when(langSelect, 'input')
                .subscribe(({ target }) => this.loadGrammar(target.value)),
            observeEvent()
                .when(themeSelect, 'input')
                .subscribe(({ target }) => this.loadTheme(target.value)),
            observeEvent()
                .when(grammarInput, 'input')
                .subscribe(() => {
                    this._langPreset.next(langSelect.value = '')
                }),
            observeEvent()
                .when(themeInput, 'input')
                .subscribe(() => {
                    this._themePreset.next(themeSelect.value = '')
                }),
        )

        grammarInput.textContent = store.grammar
        codeInput.textContent = store.code
        themeInput.textContent = store.theme
        this._grammar.next(grammarInput.innerText)
        this._code.next(codeInput.innerText)
        this._theme.next(themeInput.innerText)

        this._grammarInput = grammarInput
        this._themeInput = themeInput

        {
            const pre = el('pre')
            const info = el('footer', {
                className: 'info',
            })
            outputView.replaceChildren(pre, info)

            this._sub.add(this._scopes.subscribe(scopes => {
                info.replaceChildren(...scopes.map((scope) => el('div', [scope])))
            }))
            this._outputView = pre
        }

        {
            const media = window.matchMedia('(prefers-color-scheme: dark)')
            this._isDark.next(media.matches)
            this._sub.add(observeEvent()
                .when(media, 'change')
                .pipe(rx.map(({ target }) => target.matches))
                .subscribe(this._isDark))
        }

        this.sub(
            this
                ._grammar
                .pipe(rx.debounceTime(STORAGE_DEBOUCE_TIME))
                .subscribe(value => store.grammar = value),
            this
                ._code
                .pipe(rx.debounceTime(STORAGE_DEBOUCE_TIME))
                .subscribe(value => store.code = value),
            this
                ._theme
                .pipe(rx.debounceTime(STORAGE_DEBOUCE_TIME))
                .subscribe(value => store.theme = value),
            this
                ._langPreset
                .pipe(rx.debounceTime(STORAGE_DEBOUCE_TIME))
                .subscribe(value => store.langPreset = value),
            this
                ._themePreset
                .pipe(rx.debounceTime(STORAGE_DEBOUCE_TIME))
                .subscribe(value => store.themePreset = value),
        )

        {
            langSelect.append(...langNames.map(value => el('option', { value }, [value])))
            themeSelect.append(...themeNames.map(value => el('option', { value }, [value])))

            let langPreset = store.langPreset
            let themePreset = store.themePreset

            if (langPreset == null) {
                this.loadGrammar(store.langPreset = langPreset = 'javascript')
            }

            langSelect.value = langPreset
            themeSelect.value = themePreset ?? ''
        }
    }

    end() {
        this._sub.unsubscribe()
        delete this._outputView
    }

    updateHighlights({ tokens, fg, bg }: TokensResult) {
        this._scopes.next([])
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
                        const scopes = exp.scopes.map(s => s.scopeName)
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
                    span[nodeScopes] = explanation.flatMap(e => e.scopes.map(s => s.scopeName))
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
            if (focusNode instanceof Text) {
                const tab = tabString.value
                focusNode.replaceData(selection.focusOffset, 0, tab)
                selection.setPosition(focusNode, selection.focusOffset + tab.length)
            }
            _target.dispatchEvent(new Event('input'))
            e.preventDefault()
        } else if (e.key == 'Escape') {
            _target[_isEditing] = false
            _target.blur()
        }
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
    grammarInput: HTMLElement,
    codeInput: HTMLElement,
    themeInput: HTMLElement,
    outputView: HTMLElement,
    langSelect: HTMLSelectElement,
    themeSelect: HTMLSelectElement,
    store: Store,
}

interface Store extends Record<(
    'code' | 'grammar' | 'theme' | 'langPreset' | 'themePreset'
), string | null> { }

const app = new GrammarPlayground()

const APP_STORAGE_KEY = 'app.grammar-playground'

const STORE_KEYS = {
    grammar: `${APP_STORAGE_KEY}/input.grammar`,
    code: `${APP_STORAGE_KEY}/input.code`,
    theme: `${APP_STORAGE_KEY}/input.theme`,
    langPreset: `${APP_STORAGE_KEY}/preset.lang`,
    themePreset: `${APP_STORAGE_KEY}/preset.theme`,
    tabString: `${APP_STORAGE_KEY}/settings.tabString`,
} as const

interface StorageItem {
    value: string | null
}

function storageObject<P extends string>(storage: Storage, keys: Record<P, string>): Record<P, string | null> {
    const out: Partial<Record<P, string | null>> = {}
    for (const prop in keys) {
        const key = keys[prop]
        Object.defineProperty(out, prop, {
            get() {
                return storage.getItem(key)
            },
            set(value: string | null) {
                if (value == null) {
                    storage.removeItem(key)
                } else {
                    storage.setItem(key, value)
                }
            },
        })
    }
    return out as Record<P, string | null>
};

(global as any)._initScript = () => {
    const store = storageObject(sessionStorage, STORE_KEYS)

    function getTabString(input: string): string | null {
        if (input == 'tab') return '\t'
        const num = Number(input)
        if (num > 0) return ' '.repeat(num)
        return null
    }

    const tabString = { value: store.tabString ??= '    ' }
    const tabSelect = document.getElementById('select-tab') as HTMLSelectElement

    tabSelect.addEventListener('input', () => {
        const s = getTabString(tabSelect.value)
        if (s) { tabString.value = s }
    })

    app.begin({
        grammarInput: overrideTabBehavior(document.getElementById('grammar-in')!, tabString),
        codeInput: overrideTabBehavior(document.getElementById('code-in')!, tabString),
        themeInput: overrideTabBehavior(document.getElementById('theme-in')!, tabString),
        outputView: document.getElementById('output')!,
        langSelect: document.getElementById('select-lang') as HTMLSelectElement,
        themeSelect: document.getElementById('select-theme') as HTMLSelectElement,
        store,
    })
}
