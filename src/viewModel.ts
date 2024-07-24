import { BundledTheme, bundledThemes, createdBundledHighlighter, LanguageRegistration, TokensResult } from 'shiki'
import * as rx from 'rxjs'
import { getGrammar, getScopeSetting, getTheme } from './tmAsset'
import { Writable } from './utils'
import { debounceNow, cleanup, catchMap } from './utils/rx'
import { Store } from './store'

const LIGHT_THEME = 'solarized-light' satisfies BundledTheme
const DARK_THEME = 'solarized-dark' satisfies BundledTheme
const CUSTOM_THEME = '-custom-theme'
const CUSTOM_LANG = '-custom-lang'

const HIGHLIGHT_DEBOUNCE_TIME = 50
const REBUILD_DEBOUNCE_TIME = 750
const STORAGE_DEBOUNCE_TIME = 1_000

interface BeginArgs {
    store: Store
    baseUrl: string
}

export class GrammarPlaygroundViewModel {
    readonly grammar = new rx.ReplaySubject<string | null>(1)
    readonly code = new rx.ReplaySubject<string | null>(1)
    readonly theme = new rx.ReplaySubject<string | null>(1)
    readonly langPreset = new rx.ReplaySubject<string | null>(1)
    readonly themePreset = new rx.ReplaySubject<string | null>(1)
    readonly isDark = new rx.ReplaySubject<boolean>(1)
    readonly scopes = new rx.ReplaySubject<string[] | null>(1)

    private readonly _tokens = new rx.ReplaySubject<TokensResult | null>(1)
    readonly tokens = this._tokens.asObservable()
    baseUrl = ''

    private readonly _colors = {
        editorFg: new rx.BehaviorSubject<string | null>(null),
        editorBg: new rx.BehaviorSubject<string | null>(null),
        tokenFg: new rx.BehaviorSubject<string | null>(null),
        tokenBg: new rx.BehaviorSubject<string | null>(null),
        accent: new rx.BehaviorSubject<string | null>(null),
        tabFg: new rx.BehaviorSubject<string | null>(null),
        tabBg: new rx.BehaviorSubject<string | null>(null),
        border: new rx.BehaviorSubject<string | null>(null),
        selectFg: new rx.BehaviorSubject<string | null>(null),
        selectBg: new rx.BehaviorSubject<string | null>(null),
        dark: new rx.BehaviorSubject<boolean | null>(null),
        errorFg: new rx.BehaviorSubject<string | null>(null),
        errorBg: new rx.BehaviorSubject<string | null>(null),
    } as const

    readonly colors: rx.Observable<{
        fg: string | null,
        bg: string | null,
        accent: string | null,
        tabFg: string | null,
        tabBg: string | null,
        border: string | null,
        selectFg: string | null,
        selectBg: string | null,
        dark: boolean | null,
        errorFg: string | null,
        errorBg: string | null,
    }>

    readonly errors = {
        lang: new rx.BehaviorSubject<Error | null>(null),
        theme: new rx.BehaviorSubject<Error | null>(null),
    } as const;

    private readonly _sub
    private readonly _signal

    constructor() {
        {
            const controller = new AbortController()
            this._signal = controller.signal
            rx.ObjectUnsubscribedError
            this._sub = new rx.Subscription(() => {
                controller.abort()
            })
        }

        {
            const fg = rx.combineLatest([this._colors.editorFg, this._colors.tokenFg])
                .pipe(rx.map(([editor, token]) => editor || token))
                .pipe(rx.distinctUntilChanged())
            const bg = rx.combineLatest([this._colors.editorBg, this._colors.tokenBg])
                .pipe(rx.map(([editor, token]) => editor || token))
                .pipe(rx.distinctUntilChanged())
            this.colors = rx.combineLatest({
                fg, bg,
                accent: this._colors.accent.pipe(rx.distinctUntilChanged()),
                tabFg: this._colors.tabFg.pipe(rx.distinctUntilChanged()),
                tabBg: this._colors.tabBg.pipe(rx.distinctUntilChanged()),
                border: this._colors.border.pipe(rx.distinctUntilChanged()),
                selectFg: this._colors.selectFg.pipe(rx.distinctUntilChanged()),
                selectBg: this._colors.selectBg.pipe(rx.distinctUntilChanged()),
                dark: this._colors.dark.pipe(rx.distinctUntilChanged()),
                errorFg: this._colors.selectFg.pipe(rx.distinctUntilChanged()),
                errorBg: this._colors.selectBg.pipe(rx.distinctUntilChanged()),
            })
        }
    }

    private catchMap<T, U>(f: (item: T) => U, key: keyof (typeof this.errors)) {
        return catchMap((item: T) => {
            const out = f(item)
            return out
        }, e => {
            const error = e instanceof Error ? e : new Error(e == null ? undefined : e.toString?.() ?? String(e))
            this.errors[key].next(error)
        })
    }

    private async loadGrammar(value: string) {
        const text = await fetch(`${this.baseUrl}/langs/${value}`, { signal: this._signal }).then(res => res.text())
        this.grammar.next(text)
    }

    private async loadTheme(value: string) {
        const text = await fetch(`${this.baseUrl}/themes/${value}`, { signal: this._signal }).then(res => res.text())
        this.theme.next(text)
    }

    private sub(...teardown: rx.TeardownLogic[]) {
        for (const item of teardown) {
            this._sub.add(item)
        }
    }

    begin({ store, baseUrl }: BeginArgs): rx.Subscription {
        this.baseUrl = baseUrl

        const grammar = this.grammar
            .pipe(rx.filter(x => x != null))
            .pipe(debounceNow(REBUILD_DEBOUNCE_TIME))
            .pipe(rx.distinctUntilChanged())
            .pipe(this.catchMap(source => {
                const grammar: Writable<LanguageRegistration> | null = source ? getGrammar(source) : null
                if (!grammar) throw new Error('No grammar provided')
                return Object.assign(grammar, { name: CUSTOM_LANG } as const)
            }, 'lang'))

        const theme = this.theme
            .pipe(debounceNow(REBUILD_DEBOUNCE_TIME))
            .pipe(rx.distinctUntilChanged())
            .pipe(this.catchMap(source => source ? getTheme(source) : null, 'theme'))
            .pipe(rx.map(theme => {
                this._colors.editorFg.next(theme?.fg ?? theme?.colors?.['editor.foreground'] ?? null)
                this._colors.editorBg.next(theme?.bg ?? theme?.colors?.['editor.background'] ?? null)
                this._colors.accent.next(
                    (theme && getScopeSetting(theme, 'entity.name.type', 'foreground')) ??
                    (theme && getScopeSetting(theme, 'keyword.other', 'foreground')) ??
                    null
                )
                this._colors.tabFg.next(
                    theme?.colors?.['tab.activeForeground'] ??
                    theme?.colors?.['tab.foreground'] ??
                    null
                )
                this._colors.tabBg.next(
                    theme?.colors?.['tab.activeBackground'] ??
                    theme?.colors?.['tab.background'] ??
                    null
                )
                this._colors.border.next(
                    theme?.colors?.['editor.activeBorder'] ??
                    theme?.colors?.['editor.border'] ??
                    theme?.colors?.['editorGroup.activeBorder'] ??
                    theme?.colors?.['editorGroup.border'] ??
                    theme?.colors?.['panel.activeBorder'] ??
                    theme?.colors?.['panel.border'] ??
                    theme?.colors?.['tab.activeBorder'] ??
                    theme?.colors?.['tab.border'] ??
                    null
                )
                this._colors.selectFg.next(theme?.colors?.['editor.selectionForeground'] ?? null)
                this._colors.selectBg.next(theme?.colors?.['editor.selectionBackground'] ?? null)
                this._colors.dark.next(theme?.type == null ? null : theme.type == 'dark')
                this._colors.errorFg.next(
                    theme?.colors?.['inputValidation.errorForeground'] ??
                    theme?.colors?.['statusBarItem.errorForeground'] ??
                    theme?.colors?.['errorLens.errorForeground'] ??
                    theme?.colors?.['editorError.foreground'] ??
                    theme?.colors?.['errorForeground'] ??
                    null
                )
                this._colors.errorBg.next(
                    theme?.colors?.['inputValidation.errorBackground'] ??
                    theme?.colors?.['statusBarItem.errorBackground'] ??
                    theme?.colors?.['errorLens.errorBackground'] ??
                    theme?.colors?.['editorError.background'] ??
                    theme?.colors?.['inputValidation.background'] ??
                    theme?.colors?.['statusBar.background'] ??
                    null
                )
                return theme && Object.assign(theme, { name: CUSTOM_THEME } as const)
            }))

        const highlighter = rx.combineLatest({
            grammar, theme,
        }).pipe(this.catchMap(async ({ grammar, theme }) => {
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
        }, 'lang'), rx.switchAll(), cleanup(({ highlighter }) => highlighter.dispose()))

        const tokens = rx.combineLatest({
            highlighter,
            isDark: this.isDark,
            code: this.code.pipe(rx.distinctUntilChanged())
        })
            .pipe(debounceNow(HIGHLIGHT_DEBOUNCE_TIME))
            .pipe(this.catchMap(({ highlighter: { theme, highlighter }, code, isDark }) => highlighter.codeToTokens(code ?? '', {
                lang: CUSTOM_LANG,
                theme: theme ? CUSTOM_THEME : isDark ? DARK_THEME : LIGHT_THEME,
                includeExplanation: true,
            }), 'lang'))

        this.sub(
            tokens.subscribe(this._tokens),
            this._tokens.subscribe(tokens => {
                this.scopes.next(null)
                this.errors.lang.next(null)
                this.errors.theme.next(null)
                this._colors.tokenFg.next(tokens?.fg ?? null)
                this._colors.tokenBg.next(tokens?.bg ?? null)
            }),
            this.langPreset.subscribe(value => value && this.loadGrammar(value)),
            this.themePreset.subscribe(value => value && this.loadTheme(value)),
        )

        this.grammar.next(store.grammar)
        this.code.next(store.code ?? `class Example {
  function sayHello(name: string): void {
    console.log(\`hello, \${name}!\`);
  }
}

new Example().sayHello('world');

`)
        this.theme.next(store.theme)

        this.sub(
            this
                .grammar
                .pipe(rx.debounceTime(STORAGE_DEBOUNCE_TIME))
                .subscribe(value => store.grammar = value),
            this
                .code
                .pipe(rx.debounceTime(STORAGE_DEBOUNCE_TIME))
                .subscribe(value => store.code = value),
            this
                .theme
                .pipe(rx.debounceTime(STORAGE_DEBOUNCE_TIME))
                .subscribe(value => store.theme = value),
            this
                .langPreset
                .pipe(rx.debounceTime(STORAGE_DEBOUNCE_TIME))
                .subscribe(value => store.langPreset = value),
            this
                .themePreset
                .pipe(rx.debounceTime(STORAGE_DEBOUNCE_TIME))
                .subscribe(value => store.themePreset = value),
        )

        {
            let langPreset = store.langPreset
            let themePreset = store.themePreset

            if (langPreset == null) {
                this.loadGrammar(store.langPreset = langPreset = 'typescript')
            }

            this.langPreset.next(langPreset)
            this.themePreset.next(themePreset)
        }

        return this._sub
    }
}
