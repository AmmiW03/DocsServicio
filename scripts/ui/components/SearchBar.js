/**
 * @component SearchBar
 * Debounced search input for wiki pages.
 * Emits 'search' events on the container element.
 */

export class SearchBar {
  /**
   * @param {HTMLElement} container
   * @param {{ placeholder?: string, debounceMs?: number }} [options]
   */
  constructor(container, { placeholder = 'Buscar páginas…', debounceMs = 250 } = {}) {
    this.container   = container;
    this.debounceMs  = debounceMs;
    this._timer      = null;
    this._input      = null;
    this._render(placeholder);
  }

  _render(placeholder) {
    this.container.innerHTML = `
      <div class="searchbar" role="search">
        <svg class="searchbar__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="11" cy="11" r="7"/>
          <line x1="16.5" y1="16.5" x2="22" y2="22"/>
        </svg>
        <input
          id="wiki-search-input"
          class="searchbar__input"
          type="search"
          placeholder="${placeholder}"
          autocomplete="off"
          spellcheck="false"
          aria-label="${placeholder}"
        />
        <button class="searchbar__clear" id="wiki-search-clear" aria-label="Limpiar búsqueda" hidden>
          <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `;

    this._input       = this.container.querySelector('#wiki-search-input');
    this._clearBtn    = this.container.querySelector('#wiki-search-clear');

    this._input.addEventListener('input', () => this._onInput());
    this._clearBtn.addEventListener('click', () => this.clear());
  }

  _onInput() {
    const value = this._input.value;
    this._clearBtn.hidden = !value;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this.container.dispatchEvent(new CustomEvent('search', {
        bubbles: true,
        detail: { query: value },
      }));
    }, this.debounceMs);
  }

  /** @param {string} query */
  setValue(query) {
    this._input.value     = query;
    this._clearBtn.hidden = !query;
  }

  clear() {
    this._input.value     = '';
    this._clearBtn.hidden = true;
    this._input.focus();
    this.container.dispatchEvent(new CustomEvent('search', {
      bubbles: true,
      detail: { query: '' },
    }));
  }

  focus() {
    this._input?.focus();
  }
}
