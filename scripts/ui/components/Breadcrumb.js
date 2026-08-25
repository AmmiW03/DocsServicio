/**
 * @component Breadcrumb
 * Navigation breadcrumb: Home → Project Name → Wiki Page Title
 */

import { navigate } from '../router.js';

export class Breadcrumb {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
  }

  /**
   * @param {Array<{ label: string, path?: string }>} crumbs
   * Last crumb has no path (current page).
   */
  render(crumbs) {
    this.container.innerHTML = '';
    const nav = document.createElement('nav');
    nav.className    = 'breadcrumb';
    nav.setAttribute('aria-label', 'breadcrumb');

    crumbs.forEach((crumb, i) => {
      const isLast = i === crumbs.length - 1;

      if (i > 0) {
        const sep = document.createElement('span');
        sep.className   = 'breadcrumb__sep';
        sep.textContent = '/';
        sep.setAttribute('aria-hidden', 'true');
        nav.appendChild(sep);
      }

      if (isLast || !crumb.path) {
        const span = document.createElement('span');
        span.className        = 'breadcrumb__current';
        span.textContent      = crumb.label;
        span.setAttribute('aria-current', 'page');
        nav.appendChild(span);
      } else {
        const a = document.createElement('a');
        a.className   = 'breadcrumb__link';
        a.textContent = crumb.label;
        a.href        = `#${crumb.path}`;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          navigate(crumb.path);
        });
        nav.appendChild(a);
      }
    });

    this.container.appendChild(nav);
  }

  clear() {
    this.container.innerHTML = '';
  }
}
