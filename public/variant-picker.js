/* Egasa variant picker + hash redirect.
 * External classic script (CSP-safe: served from same origin, 'self' allowed).
 * Reads product/variant data from the #store-data JSON block written by the
 * server. Wires size/color buttons on [data-variant-picker], updates the price
 * / stock / image display, records the selected variant id on the add-to-cart
 * button and in a hidden input, and patches the cart line written by store.ts
 * so it carries variantId + variantLabel + variant sku/price/revision.
 */
(function () {
  'use strict';
  var CART_KEY = 'dar-cart-v1';

  // --- helpers (mirror src/shared/commerce.ts pure functions) ---------------
  function variantLabel(v) {
    if (!v) return '';
    var parts = [];
    if (v.sizeLabel) parts.push(v.sizeLabel);
    if (v.colorName) parts.push(v.colorName);
    return parts.join(' \u00B7 ');
  }
  function variantRevisionMix(revision, variant) {
    if (!variant) return revision;
    var h = 2166136261;
    var s = variant.id + ':' + variant.priceDelta;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((revision >>> 0) ^ (h >>> 0)) >>> 0;
  }
  function activeVariants(p) {
    return (p.variants || [])
      .filter(function (v) { return v.active; })
      .sort(function (a, b) { return a.sort - b.sort; });
  }
  function money(cents, settings) {
    var rate = settings && settings.currency_rate;
    var value = cents / 100;
    if (rate && Number.isFinite(rate) && rate !== 1) value = value * rate;
    var symbol = (settings && (settings.currency_symbol || settings.currency_code)) || '';
    var formatted = String(Math.round(value * 100) / 100);
    return symbol ? formatted + ' ' + symbol : formatted;
  }

  function readStoreData() {
    var el = document.getElementById('store-data');
    if (!el) return null;
    try { return JSON.parse(el.textContent || '{}'); } catch (e) { return null; }
  }

  // --- legacy hash redirect (#product/slug, #p/slug) ------------------------
  function hashRedirect() {
    var hash = location.hash || '';
    var m = hash.match(/^#(?:product|p)\/(.+)$/);
    if (!m) return;
    var slug = decodeURIComponent(m[1].split('?')[0].split('#')[0]);
    if (!slug) return;
    try { history.replaceState(null, '', '/products/' + slug); } catch (e) {}
    location.assign('/products/' + slug);
  }

  // --- variant picker wiring ------------------------------------------------
  function wirePicker(root, data) {
    var productId = root.getAttribute('data-product-id');
    if (!productId) return;
    var products = (data && data.products) || [];
    var settings = (data && data.settings) || {};
    var p = products.find(function (x) { return x.id === productId; });
    if (!p) return;
    var variants = activeVariants(p);
    if (!variants.length) return;

    var sizeButtons = root.querySelectorAll('[data-variant-size]');
    var colorButtons = root.querySelectorAll('[data-variant-color]');
    var priceEl = root.querySelector('[data-variant-price]');
    var originalPriceEl = root.querySelector('[data-variant-original-price]');
    var stockEl = root.querySelector('[data-variant-stock]');
    var imageEl = document.querySelector('[data-variant-image="' + productId + '"]');
    var variantInput = root.querySelector('input[name="variantId"]');
    var addButton = document.getElementById('add-offer') ||
      document.querySelector('[data-add-offer][data-product-id="' + productId + '"]');

    var state = { size: null, color: null };

    // initial selection: first active variant (SSR should have pre-selected it)
    var first = variants[0];
    if (first) {
      state.size = first.sizeLabel;
      state.color = first.colorName;
    }

    function selectedVariant() {
      // exact match first, then fall back to size-only / color-only / first
      var exact = variants.find(function (v) {
        return (!state.size || v.sizeLabel === state.size) &&
               (!state.color || v.colorName === state.color);
      });
      if (exact) return exact;
      var bySize = state.size && variants.find(function (v) { return v.sizeLabel === state.size; });
      if (bySize) return bySize;
      var byColor = state.color && variants.find(function (v) { return v.colorName === state.color; });
      if (byColor) return byColor;
      return variants[0] || null;
    }

    function refresh() {
      var v = selectedVariant();
      var unit = p.price + (v ? v.priceDelta : 0);
      if (priceEl) priceEl.textContent = money(unit, settings);
      if (originalPriceEl && p.originalPrice && p.originalPrice > unit) {
        originalPriceEl.textContent = money(p.originalPrice, settings);
        originalPriceEl.hidden = false;
      } else if (originalPriceEl) {
        originalPriceEl.hidden = true;
      }
      if (stockEl) {
        var stock = v ? v.stock : p.stock;
        stockEl.textContent = stock > 0 ?
          (stock <= 5 ? '\u0641\u0642\u0637 ' + stock + ' \u0645\u062A\u0628\u0642\u064A' : '\u0645\u062A\u0648\u0641\u0631 \u0641\u064A \u0627\u0644\u0645\u062E\u0632\u0646') :
          '\u0646\u0641\u062F \u0645\u0646 \u0627\u0644\u0645\u062E\u0632\u0646';
        stockEl.setAttribute('data-stock', String(stock));
      }
      if (variantInput) variantInput.value = v ? v.id : '';
      if (addButton) {
        if (v) addButton.setAttribute('data-variant-id', v.id);
        else addButton.removeAttribute('data-variant-id');
        addButton.disabled = !v || v.stock < 1;
      }
      // reflect selected state on buttons
      sizeButtons.forEach(function (b) {
        b.classList.toggle('is-selected', b.getAttribute('data-variant-size') === state.size);
      });
      colorButtons.forEach(function (b) {
        b.classList.toggle('is-selected', b.getAttribute('data-variant-color') === state.color);
      });
      // variant image (if image_id resolves to /media/<uuid>.webp — skip if absent)
      if (imageEl && v && v.imageId) {
        var src = '/media/' + v.imageId + '.webp';
        if (imageEl.tagName === 'IMG') imageEl.src = src;
        else imageEl.style.backgroundImage = 'url(' + src + ')';
      }
    }

    sizeButtons.forEach(function (b) {
      b.addEventListener('click', function () {
        state.size = b.getAttribute('data-variant-size');
        refresh();
      });
    });
    colorButtons.forEach(function (b) {
      b.addEventListener('click', function () {
        state.color = b.getAttribute('data-variant-color');
        refresh();
      });
    });

    // Intercept add-to-cart: let store.ts add() write the base line, then patch
    // it with variant identity/price/revision and trigger a re-render via a
    // synthetic storage event (store.ts listens to window 'storage' on CART_KEY).
    function patchCartWithVariant() {
      var v = selectedVariant();
      if (!v) return;
      setTimeout(function () {
        var cart;
        try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch (e) { return; }
        if (!Array.isArray(cart) || !cart.length) return;
        var line = null;
        for (var i = cart.length - 1; i >= 0; i--) {
          var l = cart[i];
          if (l.productId === p.id && !l.variantId) { line = l; break; }
        }
        if (!line) return;
        line.variantId = v.id;
        line.variantLabel = variantLabel(v);
        line.sku = v.sku || line.sku;
        line.unitPrice = line.unitPrice + v.priceDelta;
        line.subtotal = (line.subtotal != null ? line.subtotal : line.unitPrice * line.quantity) +
          v.priceDelta * line.quantity;
        line.revision = variantRevisionMix(line.revision, v);
        try {
          localStorage.setItem(CART_KEY, JSON.stringify(cart));
          window.dispatchEvent(new StorageEvent('storage', { key: CART_KEY }));
        } catch (e) { /* storage unavailable */ }
      }, 0);
    }
    if (addButton) addButton.addEventListener('click', patchCartWithVariant);

    refresh();
  }

  function init() {
    hashRedirect();
    var data = readStoreData();
    document.querySelectorAll('[data-variant-picker]').forEach(function (root) {
      wirePicker(root, data);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
