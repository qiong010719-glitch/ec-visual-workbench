window.openSampleGuide = function () {
    document.getElementById('sampleGuideOverlay').classList.add('show');
    if (typeof playZeldaSound === 'function') playZeldaSound('click');
  };
  window.closeSampleGuide = function () {
    document.getElementById('sampleGuideOverlay').classList.remove('show');
  };
  (function () {
    var ov = document.getElementById('sampleGuideOverlay');
    ov.addEventListener('click', function (e) { if (e.target === ov) window.closeSampleGuide(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && ov.classList.contains('show')) window.closeSampleGuide();
    });
  })();
