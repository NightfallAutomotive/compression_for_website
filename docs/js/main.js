(() => {
  const { Compressor } = window;
  const $ = (id) => document.getElementById(id);

  const form = $('options');
  const fileInput = $('file');
  const dropzone = $('dropzone');
  const status = $('status');
  const download = $('download');
  const downloadAll = $('download-all');
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
  // Two or more files: { items: [{ file, result, url, state, error, row }] }, else null
  let batch = null;

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

  // Kept on the end of every status until the next drop, e.g. "Skipped 2 files that aren't images."
  let skippedNote = '';

  function setStatus(message, isError = false) {
    status.textContent = skippedNote ? `${message} ${skippedNote}` : message;
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
    // Neutral white, so the text stays grey when grayscale is on.
    context.fillStyle = 'rgb(255 255 255 / 85%)';
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

  // Recolours the canvas pixel by pixel: first towards the Nord palette by `nordStrength` (0–1),
  // then to grayscale. Done by hand rather than with `context.filter`, which not every browser
  // supports, and so grayscale still applies after Nord has added its colours.
  function recolor(context, canvas, { nordStrength, grayscale }) {
    const lookup = nordStrength ? getNordLookup() : null;
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const { data } = imageData;

    for (let i = 0; i < data.length; i += 4) {
      if (lookup) {
        const [nr, ng, nb] = NORD[lookup[((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)]];

        data[i] += (nr - data[i]) * nordStrength;
        data[i + 1] += (ng - data[i + 1]) * nordStrength;
        data[i + 2] += (nb - data[i + 2]) * nordStrength;
      }

      if (grayscale) {
        // Rec. 709 luma, the same weighting as the CSS grayscale() filter.
        data[i] = (0.2126 * data[i]) + (0.7152 * data[i + 1]) + (0.0722 * data[i + 2]);
        data[i + 1] = data[i];
        data[i + 2] = data[i];
      }
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

    const nordStrength = isOn('nord') ? number('nordStrength') / 100 : 0;

    if (grayscale || nordStrength || watermarkText) {
      options.drew = (context, canvas) => {
        if (grayscale || nordStrength) {
          recolor(context, canvas, { nordStrength, grayscale });
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

  // ---------- Batch: several files, same settings, one at a time ----------

  // One at a time keeps memory to a single decoded image, so 20 phone photos are fine even on a phone.

  function revokeBatchURLs() {
    if (!batch) {
      return;
    }

    batch.items.forEach((item) => {
      if (item.url) {
        URL.revokeObjectURL(item.url);
      }

      item.url = '';
      item.result = null;
    });
  }

  function renderRow(item) {
    const { row } = item;
    const name = item.result ? item.result.name || item.file.name : item.file.name;
    const nameCell = document.createElement('span');
    const sizes = document.createElement('span');
    const saving = document.createElement('span');
    const action = document.createElement('span');

    nameCell.className = 'batch-name';
    nameCell.textContent = name;
    nameCell.title = name;
    sizes.className = 'batch-sizes';
    saving.className = 'batch-saving';
    action.className = 'batch-action';
    row.dataset.state = item.state;

    if (item.state === 'done') {
      const ratio = 1 - (item.result.size / item.file.size);
      const percent = Math.round(ratio * 1000) / 10;
      const link = document.createElement('a');

      sizes.textContent = `${formatSize(item.file.size)} → ${formatSize(item.result.size)}`;
      saving.textContent = `${percent > 0 ? '−' : '+'}${Math.abs(percent)}%`;
      saving.classList.toggle('is-good', ratio > 0);
      link.className = 'button button-ghost button-small';
      link.href = item.url;
      link.download = name;
      link.textContent = 'Download';
      link.setAttribute('aria-label', `Download ${name}`);
      action.append(link);
    } else {
      sizes.textContent = formatSize(item.file.size);
      action.textContent = {
        waiting: 'Waiting',
        working: 'Compressing…',
        error: item.error || 'Couldn’t compress this one',
      }[item.state];
    }

    row.replaceChildren(nameCell, sizes, saving, action);
  }

  function renderBatchTotals() {
    const done = batch.items.filter((item) => item.state === 'done');
    const before = done.reduce((sum, item) => sum + item.file.size, 0);
    const after = done.reduce((sum, item) => sum + item.result.size, 0);
    const figure = $('savings-figure');

    if (!done.length) {
      figure.textContent = '–';
      figure.classList.remove('is-good', 'is-bad');
      $('savings-detail').textContent = `${batch.items.length} images`;
      $('savings-meter').style.width = '0%';
      return;
    }

    const ratio = 1 - (after / before);
    const percent = Math.round(ratio * 1000) / 10;

    figure.textContent = `${percent > 0 ? '−' : '+'}${Math.abs(percent)}%`;
    figure.classList.toggle('is-good', ratio > 0);
    figure.classList.toggle('is-bad', ratio < 0);
    $('savings-detail').textContent = `${formatSize(before)} → ${formatSize(after)} across ${done.length} of ${batch.items.length} images`;
    $('savings-meter').style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
  }

  function runBatch() {
    if (!batch) {
      return;
    }

    const id = ++runId;
    const options = readOptions();
    const startedAt = performance.now();
    const { items } = batch;
    let index = 0;

    if (currentCompressor) {
      currentCompressor.abort();
      currentCompressor = null;
    }

    revokeBatchURLs();
    items.forEach((item) => {
      item.state = 'waiting';
      item.error = '';
      renderRow(item);
    });
    renderBatchTotals();
    downloadAll.setAttribute('aria-disabled', 'true');

    const next = () => {
      if (id !== runId) {
        return;
      }

      if (index >= items.length) {
        const done = items.filter((item) => item.state === 'done').length;
        const failed = items.length - done;
        const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);

        currentCompressor = null;
        setStatus(failed
          ? `Done ${done} of ${items.length} in ${seconds} s. ${failed} couldn’t be compressed (see the list).`
          : `Done all ${items.length} in ${seconds} s.`, failed > 0 && !done);

        if (done) {
          downloadAll.removeAttribute('aria-disabled');
        }

        return;
      }

      const item = items[index];

      item.state = 'working';
      renderRow(item);
      setStatus(`Compressing ${index + 1} of ${items.length}…`);

      currentCompressor = new Compressor(item.file, {
        ...options,
        success(result) {
          if (id !== runId) {
            return;
          }

          item.result = result;
          item.url = URL.createObjectURL(result);
          item.state = 'done';
          renderRow(item);
          renderBatchTotals();
          index += 1;
          // Let the page paint between files
          setTimeout(next);
        },
        error(err) {
          if (id !== runId) {
            return;
          }

          item.state = 'error';
          item.error = err.message;
          renderRow(item);
          index += 1;
          setTimeout(next);
        },
      });
    };

    next();
  }

  function startBatch(files) {
    exitBatch();
    batch = {
      items: files.map((file) => {
        const row = document.createElement('li');

        row.className = 'batch-row';
        return { file, result: null, url: '', state: 'waiting', error: '', row };
      }),
    };

    $('batch-list').replaceChildren(...batch.items.map((item) => item.row));
    $('batch-count').textContent = `${files.length} images`;
    $('batch-panel').hidden = false;
    $('results').hidden = true;
    $('compare-panel').hidden = true;
    runBatch();
  }

  function exitBatch() {
    if (!batch) {
      return;
    }

    revokeBatchURLs();
    batch = null;
    $('batch-list').replaceChildren();
    $('batch-panel').hidden = true;
    $('results').hidden = false;
  }

  // ---------- Zip: stored (not re-compressed; the images already are) ----------

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);

    for (let n = 0; n < 256; n += 1) {
      let c = n;

      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }

      table[n] = c >>> 0;
    }

    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;

    for (let i = 0; i < bytes.length; i += 1) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
  }

  async function makeZip(files) {
    const encoder = new TextEncoder();
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [];
    const central = [];
    let offset = 0;

    for (const { name, blob } of files) {
      const data = new Uint8Array(await blob.arrayBuffer());
      const nameBytes = encoder.encode(name);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      const entry = new DataView(new ArrayBuffer(46));

      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, 0, true); // stored
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);

      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, 0, true);
      entry.setUint16(12, time, true);
      entry.setUint16(14, date, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, data.length, true);
      entry.setUint32(24, data.length, true);
      entry.setUint16(28, nameBytes.length, true);
      entry.setUint32(42, offset, true);

      parts.push(local, nameBytes, data);
      central.push(entry, nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }

    const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));

    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }

  // Two files can't share a name in a zip: "photo.jpg", "photo (2).jpg", …
  function uniqueNames(items) {
    const seen = new Map();

    return items.map((item) => {
      const name = item.result.name || item.file.name;
      const count = (seen.get(name.toLowerCase()) || 0) + 1;
      const dot = name.lastIndexOf('.');

      seen.set(name.toLowerCase(), count);

      if (count === 1) {
        return { name, blob: item.result };
      }

      return {
        name: dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`,
        blob: item.result,
      };
    });
  }

  // Re-run whatever is on screen with the current settings
  function rerun() {
    if (batch) {
      runBatch();
    } else {
      compress();
    }
  }

  // Several files start a batch; one file opens the single-image view
  function loadFiles(list) {
    const all = [...list];
    const images = all.filter((file) => file.type.startsWith('image/'));
    const skipped = all.length - images.length;

    skippedNote = images.length && skipped
      ? `Skipped ${skipped} file${skipped > 1 ? 's' : ''} that ${skipped > 1 ? 'aren’t images' : 'isn’t an image'}.`
      : '';

    if (!images.length) {
      if (all.length) {
        setStatus(all.length === 1 ? `"${all[0].name}" is not an image.` : 'None of those files are images.', true);
      }

      return;
    }

    if (images.length === 1) {
      load(images[0]);
    } else {
      startBatch(images);
    }
  }

  function load(file) {
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setStatus(`"${file.name}" is not an image.`, true);
      return;
    }

    exitBatch();
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
    debounceTimer = setTimeout(rerun, 250);
  });

  Object.values(effects).forEach((button) => {
    button.addEventListener('click', () => {
      button.setAttribute('aria-pressed', String(!isOn(button.id.replace('effect-', ''))));
      $('watermark-field').hidden = !isOn('watermark');
      $('nord-field').hidden = !isOn('nord');
      rerun();
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
      rerun();
    });
  });

  form.addEventListener('submit', (event) => event.preventDefault());

  fileInput.addEventListener('change', () => {
    loadFiles(fileInput.files);
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
    loadFiles(event.dataTransfer.files);
  });

  document.addEventListener('paste', (event) => {
    const files = [...event.clipboardData.items]
      .filter((entry) => entry.type.startsWith('image/'))
      .map((entry, index) => {
        const blob = entry.getAsFile();

        return new File([blob], blob.name || `pasted-image-${index + 1}.png`, { type: blob.type });
      });

    if (files.length) {
      loadFiles(files);
    }
  });

  downloadAll.addEventListener('click', (event) => {
    event.preventDefault();

    if (!batch || downloadAll.hasAttribute('aria-disabled')) {
      return;
    }

    const done = batch.items.filter((item) => item.state === 'done');

    downloadAll.setAttribute('aria-disabled', 'true');
    setStatus(`Zipping ${done.length} images…`);

    makeZip(uniqueNames(done)).then((zip) => {
      const url = URL.createObjectURL(zip);
      const link = document.createElement('a');

      link.href = url;
      link.download = 'nightfall-compressed.zip';
      document.body.append(link);
      link.click();
      link.remove();
      // Give the browser time to start the download before letting go of the file
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setStatus(`Saved ${done.length} images as nightfall-compressed.zip (${formatSize(zip.size)}).`);
    }, () => {
      setStatus('The zip couldn’t be made. Try the Download buttons in the list instead.', true);
    }).finally(() => {
      if (batch) {
        downloadAll.removeAttribute('aria-disabled');
      }
    });
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
