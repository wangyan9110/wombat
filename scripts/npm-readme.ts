import { fromMarkdown } from 'mdast-util-from-markdown';
type Root = ReturnType<typeof fromMarkdown>;
interface MarkdownNode {
  type: string;
  position?: Root['position'];
  children?: MarkdownNode[];
}

/** Resolve documentation links only in the staged npm copy; source stays relative. */
export function npmReadme(markdown: string, ref: string): string {
  if (!ref || !/^[a-zA-Z0-9._/-]+$/.test(ref) || ref.split('/').some(part => !part || part === '..')) {
    throw new Error('Invalid public Git reference');
  }
  const encodedRef = ref.split('/').map(encodeURIComponent).join('/');
  const repository = 'https://github.com/wangyan9110/wombat';
  function resolve(url: string): string {
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(url)) return url;
    const local = url.replace(/^\.\//, '');
    return local.startsWith('assets/')
      ? `https://raw.githubusercontent.com/wangyan9110/wombat/${encodedRef}/${local}`
      : `${repository}/blob/${encodedRef}/${local}`;
  }
  const edits: { start: number; end: number; value: string }[] = [];
  function visit(node: MarkdownNode): void {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      const original = markdown.slice(start, end);
      let value = original;
      if (node.type === 'link' || node.type === 'image' || node.type === 'definition') {
        // The README uses inline destinations; definitions are supported for future edits.
        const destination = node.type === 'definition'
          ? /(^\s*\[[^\]]+\]:\s*<?)([^\s>]+)/
          : /(\]\(<?)([^\s)>]+)/;
        value = original.replace(destination, (_match, prefix: string, url: string) => prefix + resolve(url));
      } else if (node.type === 'html') {
        value = original.replace(/\b(src|href|srcset)=(['"])(.*?)\2/g, (_match, attribute: string, quote: string, url: string) => {
          const resolved = attribute === 'srcset'
            ? url.split(',').map(item => item.trim().replace(/^\S+/, resolve)).join(', ')
            : resolve(url);
          return `${attribute}=${quote}${resolved}${quote}`;
        });
      }
      if (value !== original) edits.push({ start, end, value });
    }
    node.children?.forEach(visit);
  }
  visit(fromMarkdown(markdown));
  return edits.sort((a, b) => b.start - a.start).reduce((result, edit) =>
    result.slice(0, edit.start) + edit.value + result.slice(edit.end), markdown);
}
