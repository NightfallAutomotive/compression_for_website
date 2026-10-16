(() => {
  const { Compressor } = window;
  const $ = (id) => document.getElementById(id);

  const form = $('options');
  const fileInput = $('file');
  const dropzone = $('dropzone');
  const status = $('status');
  const download = $('download');
  const compare = $('compare');
  const effects = {
    grayscale: $('effect-grayscale'),
    watermark: $('effect-watermark'),
    nord: $('effect-nord'),
  };

  // The 16 colours of the Nord palette (https://www.nordtheme.com).
  const NORD = [
    0x2e3440, 0x3b4252, 0x434c5e, 0x4c566a,
    0xd8dee9, 0xe5e9f0, 0xeceff4,
    0x8fbcbb, 0x88c0d0, 0x81a1c1, 0x5e81ac,
    0xbf616a, 0xd08770, 0xebcb8b, 0xa3be8c, 0xb48ead,
  ].map((hex) => [hex >> 16, (hex >> 8) & 0xff, hex & 0xff]);
  let nordLookup = null;

  const urls = { input: '', output: '' };
  let currentFile = null;
  let currentCompressor = null;
  let runId = 0;
  let debounceTimer = 0;

  function formatSize(bytes) {
    if (!(bytes >= 0)) {
      return 'N/A';
    }

    if (bytes >= 1024 * 1024) {
      return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }

    if (bytes >= 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${bytes} B`;
  }

  function setURL(key, blob) {
    if (urls[key]) {
      URL.revokeObjectURL(urls[key]);
    }

    urls[key] = blob ? URL.createObjectURL(blob) : '';
    return urls[key];
  }

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  }

  // Shows the image and its details, resolving with its natural size once loaded.
  function renderImage(key, file, url) {
    const preview = $(`${key}-preview`);
    const meta = $(`${key}-meta`);
    const image = new Image();

    image.alt = key === 'input' ? 'Original image' : 'Compressed image';
    image.src = url;
    preview.replaceChildren(image);

    return image.decode().catch(() => {}).then(() => {
      const rows = [
        ['Name', file.name || 'N/A'],
        ['Type', file.type || 'N/A'],
        ['Size', formatSize(file.size)],
        ['Dimensions', image.naturalWidth ? `${image.naturalWidth} × ${image.naturalHeight}` : 'N/A'],
      ];

      meta.replaceChildren(...rows.flatMap(([term, value]) => {
        const dt = document.createElement('dt');
        const dd = document.createElement('dd');

        dt.textContent = term;
        dd.textContent = value;
        dd.title = value;
        return [dt, dd];
      }));
    });
  }

  function renderSavings(input, output) {
    const figure = $('savings-figure');
    const ratio = 1 - (output.size / input.size);
    const percent = Math.round(ratio * 1000) / 10;

    figure.textContent = `${percent > 0 ? '−' : '+'}${Math.abs(percent)}%`;
    figure.classList.toggle('is-good', ratio > 0);
    figure.classList.toggle('is-bad', ratio < 0);
    $('savings-detail').textContent = output === input
      ? `Kept the original (${formatSize(input.size)}): compressing would have made it larger.`
      : `${formatSize(input.size)} → ${formatSize(output.size)}`;
    $('savings-meter').style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
  }

  function isOn(effect) {
    return effects[effect].getAttribute('aria-pressed') === 'true';
  }

  function drawWatermark(context, canvas, text) {
    const size = Math.max(14, Math.round(canvas.width / 28));
    const margin = Math.round(size * 0.8);

    context.save();
    context.font = `700 ${size}px Inter, "Segoe UI", Arial, sans-serif`;
    context.textAlign = 'right';
    context.textBaseline = 'bottom';
    context.shadowColor = 'rgb(0 0 0 / 50%)';
    context.shadowBlur = size / 4;
    context.fillStyle = 'rgb(236 239 244 / 85%)';
    context.fillText(text, canvas.width - margin, canvas.height - margin);
    context.restore();
  }

  // Maps every colour (at 5 bits per channel) to its nearest Nord colour, built once on first use.
  function getNordLookup() {
    if (nordLookup) {
      return nordLookup;
    }

    nordLookup = new Uint8Array(32 * 32 * 32);

    for (let key = 0; key < nordLookup.length; key += 1) {
      const r = ((key >> 10) << 3) + 4;
      const g = (((key >> 5) & 31) << 3) + 4;
      const b = ((key & 31) << 3) + 4;
      let best = 0;
      let bestDistance = Infinity;

      NORD.forEach(([nr, ng, nb], index) => {
        // "Redmean" distance: a cheap approximation of how different two colours look.
        const mean = (r + nr) / 2;
        const dr = r - nr;
        const dg = g - ng;
        const db = b - nb;
        const distance = ((512 + mean) * dr * dr / 256) + (4 * dg * dg) + ((767 - mean) * db * db / 256);

        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });

      nordLookup[key] = best;
    }

    return nordLookup;
  }

  // Recolours the canvas with the Nord palette, blended with the original by `strength` (0–1).
  function nordify(context, canvas, strength) {
    const lookup = getNordLookup();
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const { data } = imageData;

    for (let i = 0; i < data.length; i += 4) {
      const [nr, ng, nb] = NORD[lookup[((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)]];

      data[i] += (nr - data[i]) * strength;
      data[i + 1] += (ng - data[i + 1]) * strength;
      data[i + 2] += (nb - data[i + 2]) * strength;
    }

    context.putImageData(imageData, 0, 0);
  }

  function readOptions() {
    const data = new FormData(form);
    const number = (name) => {
      const value = data.get(name);

      return value === '' || value === null ? undefined : Number(value);
    };

    const options = {
      quality: number('quality'),
      mimeType: data.get('mimeType'),
      maxWidth: number('maxWidth'),
      maxHeight: number('maxHeight'),
      minWidth: number('minWidth'),
      minHeight: number('minHeight'),
      width: number('width'),
      height: number('height'),
      resize: data.get('resize'),
      strict: data.has('strict'),
      checkOrientation: data.has('checkOrientation'),
      retainExif: data.has('retainExif'),
      convertTypes: String(data.get('convertTypes') || '').split(',').map((type) => type.trim()).filter(Boolean),
      convertSize: number('convertSize'),
    };

    const grayscale = isOn('grayscale');
    const watermarkText = isOn('watermark') ? String(data.get('watermarkText') || '').trim() : '';

    if (grayscale) {
      options.beforeDraw = (context) => {
        context.filter = 'grayscale(100%)';
      };
    }

    const nordStrength = isOn('nord') ? number('nordStrength') / 100 : 0;

    if (nordStrength || watermarkText) {
      options.drew = (context, canvas) => {
        if (nordStrength) {
          nordify(context, canvas, nordStrength);
        }

        // Drawn last so the text stays crisp rather than being recoloured.
        if (watermarkText) {
          drawWatermark(context, canvas, watermarkText);
        }
      };
    }

    // `strict` hands back the untouched original when it is smaller, which would hide the effect.
    if (grayscale || watermarkText || nordStrength) {
      options.strict = false;
    }

    return options;
  }

  function compress() {
    if (!currentFile) {
      return;
    }

    const input = currentFile;
    const id = ++runId;

    if (currentCompressor) {
      currentCompressor.abort();
    }

    setStatus('Compressing…');
    const startedAt = performance.now();

    currentCompressor = new Compressor(input, {
      ...readOptions(),
      success(result) {
        if (id !== runId) {
          return;
        }

        currentCompressor = null;

        const url = setURL('output', result);

        renderImage('output', result, url);
        renderSavings(input, result);
        setStatus(`Done in ${Math.round(performance.now() - startedAt)} ms.`);

        download.href = url;
        download.download = result.name || 'compressed';
        download.removeAttribute('aria-disabled');

        $('compare-before').src = urls.input;
        $('compare-after').src = url;
        $('compare-panel').hidden = false;
      },
      error(err) {
        // Errors from a compression we replaced are expected, so ignore them.
        if (id !== runId) {
          return;
        }

        currentCompressor = null;
        setStatus(err.message, true);
      },
    });
  }

  function load(file) {
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setStatus(`"${file.name}" is not an image.`, true);
      return;
    }

    currentFile = file;
    renderImage('input', file, setURL('input', file));
    compress();
  }

  form.addEventListener('input', (event) => {
    if (event.target.name === 'quality') {
      $('quality-value').textContent = event.target.value;
    }

    if (event.target.name === 'nordStrength') {
      $('nord-strength-value').textContent = `${event.target.value}%`;
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(compress, 250);
  });

  Object.values(effects).forEach((button) => {
    button.addEventListener('click', () => {
      button.setAttribute('aria-pressed', String(!isOn(button.id.replace('effect-', ''))));
      $('watermark-field').hidden = !isOn('watermark');
      $('nord-field').hidden = !isOn('nord');
      compress();
    });
  });

  form.addEventListener('reset', () => {
    Object.values(effects).forEach((button) => button.setAttribute('aria-pressed', 'false'));
    $('watermark-field').hidden = true;
    $('nord-field').hidden = true;

    // The form's values change after this event, so read them on the next tick.
    setTimeout(() => {
      $('quality-value').textContent = form.elements.quality.value;
      $('nord-strength-value').textContent = `${form.elements.nordStrength.value}%`;
      compress();
    });
  });

  form.addEventListener('submit', (event) => event.preventDefault());

  fileInput.addEventListener('change', () => {
    load(fileInput.files[0]);
    fileInput.value = '';
  });

  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  });

  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));

  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragging');
    load(event.dataTransfer.files[0]);
  });

  document.addEventListener('paste', (event) => {
    const item = [...event.clipboardData.items].find((entry) => entry.type.startsWith('image/'));

    if (item) {
      const blob = item.getAsFile();

      load(new File([blob], blob.name || 'pasted-image.png', { type: blob.type }));
    }
  });

  $('compare-range').addEventListener('input', (event) => {
    compare.style.setProperty('--position', `${event.target.value}%`);
  });

  // Start with the sample image so the page shows a result straight away.
  fetch('images/sample.jpg')
    .then((response) => response.blob())
    .then((blob) => load(new File([blob], 'sample.jpg', { type: blob.type })))
    .catch(() => setStatus('Choose an image to get started.'));
})();
