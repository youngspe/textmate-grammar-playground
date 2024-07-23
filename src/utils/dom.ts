export type ElementForTag<Tag extends string> = Tag extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[Tag] : HTMLElement

export function el<Tag extends keyof HTMLElementTagNameMap | string>(
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
