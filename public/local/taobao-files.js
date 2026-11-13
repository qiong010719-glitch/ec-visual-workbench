// Preserve image bytes and report the actual file format and dimensions.
(() => {
  const safeName = value => String(value || '图片').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 80);
  async function read(url) {
    const address = new URL(url, location.href);
    if (address.origin !== location.origin && !['data:', 'blob:'].includes(address.protocol)) {
      throw new Error('图片尚未保存到本机，请先导入图片再下载。');
    }
    const response = await fetch(address.href, {signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error('图片读取失败，请刷新后重试下载。');
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const is = (offset, values) => values.every((value, i) => bytes[offset + i] === value);
    const type = is(0, [137,80,78,71,13,10,26,10]) ? ['png','image/png']
      : is(0, [255,216,255]) ? ['jpg','image/jpeg']
      : is(0, [82,73,70,70]) && is(8, [87,69,66,80]) ? ['webp','image/webp'] : null;
    if (!type) throw new Error('未读到有效的 PNG、JPEG 或 WebP 图片，请检查图片是否加载完整。');
    const original = blob.slice(0, blob.size, type[1]);
    const bitmap = await createImageBitmap(original);
    const result = {blob:original, extension:type[0], width:bitmap.width, height:bitmap.height};
    bitmap.close();
    return result;
  }
  function name(label, file) { return `${safeName(label)}_${file.width}x${file.height}.${file.extension}`; }
  function save(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.hidden = true;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  async function download(item) {
    const file = await read(item.url);
    save(file.blob, name(item.label, file));
  }
  async function bundle(items, progress) {
    const zip = new JSZip(), failed = [];
    let count = 0;
    for (const item of items) {
      try {
        const file = await read(item.url);
        zip.file(name(item.label, file), file.blob);
        count++;
      } catch { failed.push(item.label); }
      progress?.(count + failed.length, items.length);
    }
    if (!count) throw new Error('图片读取失败，未生成空压缩包。请检查图片加载情况后重试下载。');
    if (failed.length) zip.file('未下载图片.txt', `以下图片未能下载：\n${failed.join('\n')}\n请检查图片加载情况，再重试下载。此次没有重新生图。`);
    const blob = await zip.generateAsync({type:'blob'});
    save(blob, `淘宝图片_${count}张.zip`);
    return {count, failed};
  }
  window.TaobaoFiles = {read, name, download, bundle};
})();
