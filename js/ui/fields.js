
/*
 * FIELD RENDERERS
 * VIP.fields.create(fieldConfig, ctx) -> { el, setError, focus, ...extras }
 * ctx = { get(id), set(id, value), limits }
 * One renderer per field type. The form itself never hard-codes a question.
 */
(function () {
  var VIP = (window.VIP = window.VIP || {});
  var h = VIP.h;

  function labelText(field) {
    return [
      field.label,
      field.required
        ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')
        : null
    ];
  }

  function errorNode(id) {
    return h('p', {
      class: 'field__error',
      id: 'err-' + id,
      role: 'alert',
      hidden: true
    });
  }

  function wrap(field, inner, extras) {
    var err = errorNode(field.id);
    var el = h(
      field.type === 'choice' ? 'fieldset' : 'div',
      { class: 'field field--' + field.type, 'data-field': field.id },
      inner,
      err
    );

    return Object.assign(
      {
        el: el,
        setError: function (msg) {
          err.textContent = msg || '';
          err.hidden = !msg;
          el.classList.toggle('has-error', !!msg);
        }
      },
      extras || {}
    );
  }

  function hint(field) {
    return field.hint
      ? h('p', { class: 'field__hint', id: 'hint-' + field.id }, field.hint)
      : null;
  }

  /* ---------- choice (radio cards) ---------- */
  function choice(field, ctx) {
    var name = 'f-' + field.id;
    var inputs = [];

    var grid = h(
      'div',
      {
        class:
          'choice choice--' +
          (field.layout || 'tiles') +
          ' choice--n' +
          field.options.length
      },
      field.options.map(function (opt, i) {
        var input = h('input', {
          type: 'radio',
          name: name,
          id: name + '-' + i,
          value: opt.value,
          checked: ctx.get(field.id) === opt.value,
          onchange: function () {
            ctx.set(field.id, opt.value);
          }
        });

        inputs.push(input);

        return h(
          'label',
          {
            class: 'tile' + (opt.tone ? ' tile--' + opt.tone : ''),
            for: name + '-' + i
          },
          input,
          h(
            'span',
            { class: 'tile__face' },
            opt.icon
              ? h(
                  'span',
                  { class: 'tile__icon', 'aria-hidden': 'true' },
                  opt.icon
                )
              : null,
            h(
              'span',
              { class: 'tile__label' },
              opt.label.replace(/\//g, '/\u200b')
            ),
            opt.desc
              ? h('span', { class: 'tile__desc' }, opt.desc)
              : null
          )
        );
      })
    );

    return wrap(
      field,
      [
        h('legend', { class: 'field__label' }, labelText(field)),
        hint(field),
        grid
      ],
      {
        focus: function () {
          var checked = inputs.filter(function (input) {
            return input.checked;
          })[0];

          (checked || inputs[0]).focus();
        }
      }
    );
  }

  /* ---------- dropdown / select ---------- */
  function select(field, ctx) {
    var id = 'f-' + field.id;

    function getOptions() {
      var result =
        typeof field.getOptions === 'function'
          ? field.getOptions(ctx)
          : field.options;

      return Array.isArray(result) ? result : [];
    }

    var control = h('select', {
      class: 'input input--select',
      id: id,
      name: field.id,
      autocomplete: 'off',
      'aria-describedby': field.hint ? 'hint-' + field.id : null,
      onchange: function () {
        ctx.set(field.id, control.value);
        updateBranchMapLink();
      }
    });

    // The selected store branch gets a direct Google Maps link. Keep the
    // address lookup separate from the form control so opening Maps is optional.
    var branchMapLink = field.id === 'branch'
      ? h('a', {
          class: 'link-btn branch-map-link',
          href: '#',
          target: '_blank',
          rel: 'noopener noreferrer',
          hidden: true
        }, 'Open this store in Google Maps')
      : null;

    function updateBranchMapLink() {
      if (!branchMapLink) return;
      var selected = getOptions().filter(function (opt) {
        var normalized = typeof opt === 'string' ? { value: opt, label: opt } : opt;
        return normalized && String(normalized.value) === String(ctx.get(field.id) || '');
      })[0];
      if (!selected || selected.value === 'manual') {
        branchMapLink.hidden = true;
        branchMapLink.href = '#';
        return;
      }
      var stateOption = VIP.formConfig && VIP.formConfig.getOption
        ? VIP.formConfig.getOption('state', ctx.get('state'), ctx)
        : null;
      var query = String(selected.label || selected.value) +
        (stateOption && stateOption.label ? ', ' + stateOption.label : '');
      branchMapLink.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
      branchMapLink.hidden = false;
    }

    function refreshOptions() {
      var previousValue = ctx.get(field.id) || '';
      var options = getOptions();

      VIP.clear(control);

      control.appendChild(
        h(
          'option',
          { value: '', disabled: true },
          field.placeholder || 'Choose an option'
        )
      );

      options.forEach(function (opt) {
        var normalized =
          typeof opt === 'string'
            ? { value: opt, label: opt }
            : opt;

        if (!normalized || normalized.value == null) return;

        control.appendChild(
          h(
            'option',
            { value: String(normalized.value) },
            normalized.label || String(normalized.value)
          )
        );
      });

      var stillValid = options.some(function (opt) {
        var normalized =
          typeof opt === 'string'
            ? { value: opt }
            : opt;

        return (
          normalized &&
          String(normalized.value) === String(previousValue)
        );
      });

      if (previousValue && stillValid) {
        control.value = String(previousValue);
      } else {
        control.value = '';

        if (previousValue) {
          ctx.set(field.id, '');
        }
      }
    }

    refreshOptions();

    return wrap(
      field,
      [
        h('label', { class: 'field__label', for: id }, labelText(field)),
        hint(field),
        control,
        branchMapLink
      ],
      {
        focus: function () {
          control.focus();
        },
        sync: function () {
          var value = ctx.get(field.id) || '';
          var options = getOptions();

          var valid = options.some(function (opt) {
            var normalized =
              typeof opt === 'string'
                ? { value: opt }
                : opt;

            return (
              normalized &&
              String(normalized.value) === String(value)
            );
          });

          if (!valid) {
            refreshOptions();
          } else {
            control.value = String(value);
          }
          updateBranchMapLink();
        },
        refreshOptions: function () {
          refreshOptions();
          updateBranchMapLink();
        }
      }
    );
  }

  /* ---------- text / price ---------- */
  function text(field, ctx) {
    var id = 'f-' + field.id;
    var isPrice = field.type === 'price';
    var isNumber = field.type === 'number';

    var input = h('input', {
      class: 'input' + (isPrice ? ' input--price' : ''),
      type: isNumber ? 'number' : 'text',
      min: isNumber ? field.min : null,
      max: isNumber ? field.max : null,
      step: isNumber ? '1' : null,
      id: id,
      name: field.id,
      value: ctx.get(field.id) || '',
      placeholder: field.placeholder || '',
      maxlength: field.maxLength || ctx.limits.textMax,
      autocomplete: field.autocomplete || 'off',
      inputmode: isPrice ? 'decimal' : isNumber ? 'numeric' : null,
      enterkeyhint: 'next',
      'aria-describedby': field.hint ? 'hint-' + field.id : null,
      oninput: function () {
        ctx.set(field.id, input.value);
      }
    });

    var control = isPrice
      ? h(
          'div',
          { class: 'input-wrap' },
          h(
            'span',
            { class: 'input-wrap__prefix', 'aria-hidden': 'true' },
            '$'
          ),
          input
        )
      : input;

    return wrap(
      field,
      [
        h('label', { class: 'field__label', for: id }, labelText(field)),
        hint(field),
        control
      ],
      {
        focus: function () {
          input.focus();
        },
        sync: function () {
          input.value = ctx.get(field.id) || '';
        }
      }
    );
  }

  /* ---------- textarea ---------- */
  function textarea(field, ctx) {
    var id = 'f-' + field.id;
    var max = field.maxLength || ctx.limits.notesMax;
    var counter = h('span', { class: 'counter' }, '0/' + max);

    var input = h('textarea', {
      class: 'input input--area',
      id: id,
      name: field.id,
      rows: '4',
      maxlength: max,
      placeholder: field.placeholder || '',
      oninput: function () {
        ctx.set(field.id, input.value);
        counter.textContent = input.value.length + '/' + max;
      }
    });

    input.value = ctx.get(field.id) || '';
    counter.textContent = input.value.length + '/' + max;

    return wrap(
      field,
      [
        h('label', { class: 'field__label', for: id }, labelText(field)),
        input,
        counter
      ],
      {
        focus: function () {
          input.focus();
        },
        sync: function () {
          input.value = ctx.get(field.id) || '';
          counter.textContent = input.value.length + '/' + max;
        }
      }
    );
  }

  /* ---------- date and time ---------- */
  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function toLocalInput(date) {
    return (
      date.getFullYear() +
      '-' +
      pad(date.getMonth() + 1) +
      '-' +
      pad(date.getDate()) +
      'T' +
      pad(date.getHours()) +
      ':' +
      pad(date.getMinutes())
    );
  }

  function datetime(field, ctx) {
    var id = 'f-' + field.id;

    var input = h('input', {
      class: 'input input--datetime',
      type: 'datetime-local',
      id: id,
      name: field.id,
      max: toLocalInput(new Date()),
      onchange: function () {
        ctx.set(
          field.id,
          input.value ? new Date(input.value).toISOString() : ''
        );
      },
      oninput: function () {
        ctx.set(
          field.id,
          input.value ? new Date(input.value).toISOString() : ''
        );
      }
    });

    function sync() {
      var value = ctx.get(field.id);
      input.max = toLocalInput(new Date());
      input.value = value ? toLocalInput(new Date(value)) : '';
    }

    var now = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--sm btn--ghost',
        onclick: function () {
          ctx.set(field.id, new Date().toISOString());
          sync();
        }
      },
      'Just now'
    );

    sync();

    return wrap(
      field,
      [
        h('label', { class: 'field__label', for: id }, labelText(field)),
        h('div', { class: 'datetime-row' }, input, now)
      ],
      {
        focus: function () {
          input.focus();
        },
        sync: sync
      }
    );
  }

  /* ---------- photos ---------- */
  function photos(field, ctx) {
    var items = [];
    var pending = 0;
    var waiters = [];
    var msg = h('p', { class: 'field__note', role: 'status' });
    var grid = h('ul', { class: 'thumbs' });

    var input = h('input', {
      type: 'file',
      class: 'sr-only',
      id: 'f-photos',
      accept: 'image/*',
      multiple: true,
      onchange: function () {
        addFiles(input.files);
        input.value = '';
      }
    });

    var pick = h(
      'label',
      { class: 'dropzone', for: 'f-photos' },
      h('span', { class: 'dropzone__icon', 'aria-hidden': 'true' }, ''),
      h('span', { class: 'dropzone__title' }, 'Add photos'),
      h(
        'span',
        { class: 'dropzone__sub' },
        'Up to ' +
          ctx.limits.maxPhotos +
          ' photos. Location data is removed before upload.'
      )
    );

    function note(text) {
      msg.textContent = text || '';
    }

    function renderThumbs() {
      VIP.clear(grid);

      items.forEach(function (it) {
        grid.appendChild(
          h(
            'li',
            {
              class:
                'thumb' + (it.status === 'working' ? ' is-working' : '')
            },
            it.url
              ? h('img', {
                  src: it.url,
                  alt: 'Photo ' + (items.indexOf(it) + 1)
                })
              : null,
            it.status === 'working'
              ? h('span', {
                  class: 'thumb__spin',
                  'aria-label': 'Preparing photo'
                })
              : null,
            h(
              'button',
              {
                type: 'button',
                class: 'thumb__remove',
                'aria-label': 'Remove photo',
                onclick: function () {
                  remove(it);
                }
              },
              '×'
            )
          )
        );
      });

      pick.hidden = items.length >= ctx.limits.maxPhotos;
    }

    function remove(it) {
      items = items.filter(function (x) {
        return x !== it;
      });

      if (it.url) URL.revokeObjectURL(it.url);

      note('');
      renderThumbs();
    }

    function settle() {
      if (pending === 0) {
        waiters.splice(0).forEach(function (waiter) {
          waiter();
        });
      }
    }

    function addFiles(fileList) {
      var files = Array.prototype.slice.call(fileList || []);
      var room = ctx.limits.maxPhotos - items.length;
      var problems = [];

      if (files.length > room) {
        problems.push('You can add up to ' + ctx.limits.maxPhotos + ' photos.');
      }

      files.slice(0, Math.max(room, 0)).forEach(function (file) {
        if (!VIP.images.isImage(file)) {
          problems.push("That file isn't a photo.");
          return;
        }

        if (file.size > ctx.limits.photoInputMaxBytes) {
          problems.push('A photo is over 100 MB.');
          return;
        }

        var it = { status: 'working', blob: null, url: null };
        items.push(it);
        pending++;

        VIP.images
          .compress(file, {
            targetBytes: ctx.limits.photoUploadTargetBytes
          })
          .then(function (res) {
            it.blob = res.blob;
            it.url = URL.createObjectURL(res.blob);
            it.status = 'ready';
          })
          .catch(function () {
            it.status = 'error';
            items = items.filter(function (x) {
              return x !== it;
            });

            problems.push("Couldn't read one photo. Try a different one.");
            note(problems[problems.length - 1]);
          })
          .then(function () {
            pending--;
            renderThumbs();
            settle();
          });
      });

      note(problems[0] || '');
      renderThumbs();
    }

    renderThumbs();

    return wrap(
      field,
      [
        h('span', { class: 'field__label', id: 'lbl-photos' }, labelText(field)),
        h(
          'p',
          { class: 'field__hint' },
          'Optional, but photos make alerts far more useful.'
        ),
        grid,
        pick,
        input,
        msg
      ],
      {
        focus: function () {
          input.focus();
        },
        getPhotos: function () {
          return items.filter(function (item) {
            return item.status === 'ready';
          });
        },
        isBusy: function () {
          return pending > 0;
        },
        whenReady: function () {
          return pending === 0
            ? Promise.resolve()
            : new Promise(function (resolve) {
                waiters.push(resolve);
              });
        },
        reset: function () {
          items.forEach(function (item) {
            if (item.url) URL.revokeObjectURL(item.url);
          });

          items = [];
          note('');
          renderThumbs();
        }
      }
    );
  }

  /* ---------- renderer registry ---------- */
  VIP.fields = {
    create: function (field, ctx) {
      switch (field.type) {
        case 'choice':
          return choice(field, ctx);

        case 'select':
          return select(field, ctx);

        case 'text':
        case 'number':
        case 'price':
          return text(field, ctx);

        case 'textarea':
          return textarea(field, ctx);

        case 'datetime':
          return datetime(field, ctx);

        case 'photos':
          return photos(field, ctx);

        default:
          throw new Error('Unknown field type: ' + field.type);
      }
    }
  };
})();
