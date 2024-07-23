import * as rx from 'rxjs'

export const catchMap = <T, U>(
    f: Parameters<typeof rx.map<T, U>>[0],
    onError: (e: unknown) => rx.ObservableInput<U> | void,
): rx.OperatorFunction<T, U> => rx.switchMap((...args) => {
    try { return rx.of(f(...args)) }
    catch (e) { return onError(e) as rx.ObservableInput<U> ?? rx.EMPTY }
})

export const cleanup = <T>(f: (previous: T) => void) => rx.scan<T>((acc, item) => {
    f(acc)
    return item
})

module DelayState {
    export const Ready = Symbol('ready')
    export const Delaying = Symbol('delaying')
}

type DelayState<T> = (typeof DelayState)[keyof typeof DelayState] | T

export const debounceNow = <T>(
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


export interface TypedEventTarget<This, Map extends object> {
    addEventListener<K extends keyof Map>(this: This, name: K, listener: (this: This, event: Map[K]) => void): void
    removeEventListener<K extends keyof Map>(this: This, name: K, listener: (this: This, event: Map[K]) => void): void
}

export interface SingleEventTarget<This, K extends PropertyKey, E> {
    addEventListener(this: This, name: K, listener: (this: This, event: E) => void): void
    removeEventListener(this: This, name: K, listener: (this: This, event: E) => void): void
}

export function observeEvent<Map extends object = HTMLElementEventMap>() {
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