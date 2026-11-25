/* Painel para iPad antigo — ES5 puro (sem let/const, arrow, fetch, Intl). */
(function () {
  'use strict';

  var CONFIG = {
    trocaNoticiasSeg: 20,
    recarregarDadosMin: 10,
    tempoAoVivoMin: 15,
    recarregarPaginaHoras: 6,   // evita vazamento de memória no Safari antigo
    noiteInicio: 23,            // escurece automaticamente das 23h…
    noiteFim: 6,                // …até as 6h
    retratosACadaMin: 10,       // porta-retratos entra a cada 10 min…
    retratosDuracaoSeg: 60,     // …fica 1 min na tela…
    retratosTrocaSeg: 15        // …e troca de foto a cada 15 s
  };

  var DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  var DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  // Códigos WMO usados pelo Open-Meteo -> tipo de ícone + descrição
  function clima(c, dia) {
    if (c === 0) return { i: dia ? 'sol' : 'lua', d: 'Céu limpo' };
    if (c === 1 || c === 2) return { i: dia ? 'solnuvem' : 'luanuvem', d: c === 1 ? 'Poucas nuvens' : 'Parcialmente nublado' };
    if (c === 3) return { i: 'nuvem', d: 'Nublado' };
    if (c === 45 || c === 48) return { i: 'neblina', d: 'Neblina' };
    if (c >= 51 && c <= 57) return { i: 'garoa', d: 'Garoa' };
    if (c >= 61 && c <= 67) return { i: 'chuva', d: c >= 65 ? 'Chuva forte' : 'Chuva' };
    if (c >= 71 && c <= 77) return { i: 'neve', d: 'Neve' };
    if (c >= 80 && c <= 82) return { i: 'chuva', d: 'Pancadas de chuva' };
    if (c >= 95) return { i: 'tempestade', d: 'Tempestade' };
    return { i: 'nuvem', d: '—' };
  }

  /* Ícones em SVG (os emojis do iOS 9 aparecem minúsculos) */
  var AMARELO = '#f2c14e', NUVEM = '#d5dde6', AZUL = '#5aa9e6';
  function svgSol(cx, cy, r) {
    var raios = '', k, ang, x1, y1, x2, y2;
    for (k = 0; k < 8; k++) {
      ang = k * Math.PI / 4;
      x1 = cx + Math.cos(ang) * (r + 4); y1 = cy + Math.sin(ang) * (r + 4);
      x2 = cx + Math.cos(ang) * (r + 10); y2 = cy + Math.sin(ang) * (r + 10);
      raios += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"/>';
    }
    return '<g stroke="' + AMARELO + '" stroke-width="3.5" stroke-linecap="round">' + raios + '</g>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + AMARELO + '"/>';
  }
  function svgLua(cx, cy, r) {
    return '<path fill="#e9e4c8" d="M' + (cx + r * 0.3) + ' ' + (cy - r) + 'A' + r + ' ' + r + ' 0 1 0 ' + (cx + r) + ' ' + (cy + r * 0.35) +
      'A' + (r * 0.8) + ' ' + (r * 0.8) + ' 0 0 1 ' + (cx + r * 0.3) + ' ' + (cy - r) + 'Z"/>';
  }
  function svgNuvem(cor, dy) {
    dy = dy || 0;
    return '<path fill="' + (cor || NUVEM) + '" d="M18 ' + (48 + dy) + 'H47A10 10 0 0 0 47 ' + (28 + dy) +
      'A14 14 0 0 0 21 ' + (25 + dy) + 'A11.5 11.5 0 0 0 18 ' + (48 + dy) + 'Z"/>';
  }
  function svgGotas(n, cor) {
    var g = '', k, x;
    for (k = 0; k < n; k++) {
      x = 22 + k * (24 / Math.max(1, n - 1));
      g += '<line x1="' + x + '" y1="' + 50 + '" x2="' + (x - 3) + '" y2="' + 58 + '"/>';
    }
    return '<g stroke="' + (cor || AZUL) + '" stroke-width="3.5" stroke-linecap="round">' + g + '</g>';
  }
  function icone(tipo) {
    var c = '';
    if (tipo === 'sol') c = svgSol(32, 32, 12);
    else if (tipo === 'lua') c = svgLua(30, 32, 16);
    else if (tipo === 'solnuvem') c = svgSol(40, 22, 9) + svgNuvem(null, 6);
    else if (tipo === 'luanuvem') c = svgLua(38, 20, 11) + svgNuvem(null, 6);
    else if (tipo === 'nuvem') c = svgNuvem() ;
    else if (tipo === 'neblina') c = '<g stroke="' + NUVEM + '" stroke-width="4" stroke-linecap="round"><line x1="12" y1="24" x2="52" y2="24"/><line x1="8" y1="34" x2="48" y2="34"/><line x1="16" y1="44" x2="56" y2="44"/></g>';
    else if (tipo === 'garoa') c = svgNuvem(null, -6) + svgGotas(3);
    else if (tipo === 'chuva') c = svgNuvem('#b9c4d0', -6) + svgGotas(4);
    else if (tipo === 'neve') c = svgNuvem(null, -6) + '<g fill="#fff"><circle cx="22" cy="54" r="3"/><circle cx="32" cy="58" r="3"/><circle cx="42" cy="54" r="3"/></g>';
    else if (tipo === 'tempestade') c = svgNuvem('#9aa6b3', -6) + '<path fill="' + AMARELO + '" d="M34 40L24 54h8l-4 10 12-16h-8l4-8z"/>';
    return '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">' + c + '</svg>';
  }

  function $(id) { return document.getElementById(id); }
  function dois(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /* Relógio independente do iPad: o iOS 9 tem regras de fuso desatualizadas
     (ainda aplica horário de verão no Brasil). Usamos a hora do servidor
     (cabeçalho Date) e o fuso informado pelo Open-Meteo. As datas "locais"
     são guardadas como UTC deslocado e lidas com getUTC*. */
  var ajuste = 0, fusoSeg = null;
  function agoraMs() { return Date.now() + ajuste; }
  function fuso() { return fusoSeg !== null ? fusoSeg : -new Date().getTimezoneOffset() * 60; }
  function agoraLocal() { return new Date(agoraMs() + fuso() * 1000); }
  // "2026-11-25T14:00" -> Date em hora local da cidade (ler com getUTC*)
  function dataLocal(s) {
    var p = s.split(/[-T:]/);
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], +(p[3] || 0), +(p[4] || 0)));
  }
  function pegarJSON(url, ok, falha) {
    pegarTexto(url, function (txt, data) {
      var j; try { j = JSON.parse(txt); } catch (e) {}
      if (j) ok(j, data); else if (falha) falha();
    }, falha);
  }
  function pegarTexto(url, ok, falha) {
    var x = new XMLHttpRequest();
    x.open('GET', url + (url.indexOf('?') < 0 ? '?' : '&') + '_=' + Date.now(), true);
    x.timeout = 20000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      if (x.status >= 200 && x.status < 300) { ok(x.responseText, x.getResponseHeader('Date')); return; }
      if (falha) falha();
    };
    x.send();
  }

  /* ---------- Relógio ---------- */
  var noiteManual = null; // null = automático
  var ehNoite = false;    // sem porta-retratos de madrugada nem no modo escuro
  function tique() {
    var d = agoraLocal();
    $('hora').innerHTML = $('retratos-hora').innerHTML = dois(d.getUTCHours()) + ':' + dois(d.getUTCMinutes());
    $('data').innerHTML = '<b>' + DIAS[d.getUTCDay()] + '</b>, ' + d.getUTCDate() + ' de ' + MESES[d.getUTCMonth()];
    var h = d.getUTCHours();
    var noiteAuto = CONFIG.noiteInicio > CONFIG.noiteFim
      ? (h >= CONFIG.noiteInicio || h < CONFIG.noiteFim)
      : (h >= CONFIG.noiteInicio && h < CONFIG.noiteFim);
    var noite = noiteManual === null ? noiteAuto : noiteManual;
    ehNoite = noiteAuto || noite;
    document.body.className = noite ? 'noite' : '';
    setTimeout(tique, 1000 - (agoraMs() % 1000));
  }
  // Tocar na tela alterna claro/escuro; dois toques voltam ao automático
  var ultimoToque = 0;
  document.addEventListener('touchend', function () {
    if (!chave) return; // tela de senha
    var agora = Date.now();
    if (fecharRetratos()) { ultimoToque = 0; return; } // toque só fecha as fotos
    if (agora - ultimoToque < 400) { noiteManual = null; }
    else { noiteManual = document.body.className !== 'noite'; }
    ultimoToque = agora;
  }, false);

  /* ---------- Tempo ---------- */
  var tempoAtual = null;
  function mostrarTempo(t) {
    if (!t || !t.current) return;
    tempoAtual = t;
    if (typeof t.utc_offset_seconds === 'number') fusoSeg = t.utc_offset_seconds;
    var c = t.current;
    var k = clima(c.weather_code, c.is_day);
    $('agora-icone').innerHTML = icone(k.i);
    $('agora-temp').innerHTML = Math.round(c.temperature_2m) + '°';
    $('agora-desc').innerHTML = k.d;

    var dd = t.daily;
    var extra = 'Sensação ' + Math.round(c.apparent_temperature) + '° · Umidade ' + c.relative_humidity_2m + '%';
    if (dd) {
      extra += '<br>Máx ' + Math.round(dd.temperature_2m_max[0]) + '° · Mín ' + Math.round(dd.temperature_2m_min[0]) + '°';
      if (dd.sunrise && dd.sunset) {
        extra += ' · nascer ' + dd.sunrise[0].slice(11, 16) + ' · pôr ' + dd.sunset[0].slice(11, 16);
      }
    }
    $('agora-extra').innerHTML = extra;

    // Próximas horas
    var hh = t.hourly, html = '', agora = agoraLocal(), n = 0, i;
    if (hh) {
      for (i = 0; i < hh.time.length && n < 10; i++) {
        var dt = dataLocal(hh.time[i]);
        if (dt.getTime() < agora.getTime() - 3600000 + 1) continue;
        if (n > 0 && dt.getUTCHours() % 2 !== 0) continue; // de 2 em 2 horas
        var hk = clima(hh.weather_code[i], dt.getUTCHours() >= 6 && dt.getUTCHours() < 19);
        var p = hh.precipitation_probability ? hh.precipitation_probability[i] : 0;
        html += '<div class="h"><div class="rot">' + (n === 0 ? 'agora' : dois(dt.getUTCHours()) + 'h') + '</div>' +
          '<div class="ic">' + icone(hk.i) + '</div><div class="t">' + Math.round(hh.temperature_2m[i]) + '°</div>' +
          '<div class="chuva">' + (p >= 20 ? p + '%' : '') + '</div></div>';
        n++;
      }
    }
    $('horas').innerHTML = html;

    // Próximos dias
    html = '';
    if (dd) {
      for (i = 0; i < dd.time.length && i < 6; i++) {
        var dia = dataLocal(dd.time[i]);
        var dk = clima(dd.weather_code[i], true);
        var pc = dd.precipitation_probability_max ? dd.precipitation_probability_max[i] : 0;
        html += '<div class="d' + (i === 0 ? ' hoje' : '') + '"><div class="rot">' + (i === 0 ? 'hoje' : DIAS_CURTOS[dia.getUTCDay()]) + '</div>' +
          '<div class="ic">' + icone(dk.i) + '</div>' +
          '<div class="t">' + Math.round(dd.temperature_2m_max[i]) + '° <span class="min">' + Math.round(dd.temperature_2m_min[i]) + '°</span></div>' +
          '<div class="chuva">' + (pc >= 20 ? pc + '% chuva' : '') + '</div></div>';
      }
    }
    $('dias').innerHTML = html;
  }

  // Busca o tempo direto no Open-Meteo (mais fresco). Se o iPad não conseguir
  // (certificado/rede), fica com o que veio no data.json.
  var coords = null, vivoOk = false;
  function tempoAoVivo() {
    if (!coords) return;
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + coords.lat + '&longitude=' + coords.lon +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day' +
      '&hourly=temperature_2m,weather_code,precipitation_probability' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset' +
      '&timezone=auto&forecast_days=6';
    pegarJSON(url, function (t) { vivoOk = true; mostrarTempo(t); });
  }

  /* ---------- Notícias ---------- */
  var noticias = [], inicio = 0;
  function haQuanto(iso) {
    if (!iso) return '';
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var min = Math.round((agoraMs() - t) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return 'há ' + min + ' min';
    var h = Math.round(min / 60);
    if (h < 24) return 'há ' + h + ' h';
    return 'há ' + Math.round(h / 24) + ' d';
  }
  // Mostra a partir de "inicio" quantas notícias couberem na tela
  var mostradas = 0;
  function mostrarPagina() {
    var lista = $('lista-noticias'), caixa = $('noticias');
    if (inicio >= noticias.length) inicio = 0;
    lista.innerHTML = '';
    mostradas = 0;
    for (var i = inicio; i < noticias.length; i++) {
      var n = noticias[i], li = document.createElement('li');
      // Miniatura só quando a notícia tem imagem (tamanho fixo no CSS,
      // para a conta de "quantas cabem" não depender do carregamento)
      li.className = n.imagem ? 'com-img' : '';
      li.innerHTML = (n.imagem ? '<img class="mini" src="' + esc(n.imagem) + '" alt="" onerror="this.style.visibility=\'hidden\'">' : '') +
        '<div class="texto"><span class="fonte">' + esc(n.fonte) + '</span>' + esc(n.titulo) +
        '<span class="quando">' + haQuanto(n.quando) + '</span></div>';
      lista.appendChild(li);
      if (caixa.scrollHeight > caixa.clientHeight + 1 && mostradas > 0) { lista.removeChild(li); break; }
      mostradas++;
    }
    if (!noticias.length) lista.innerHTML = '<li>Sem notícias no momento.</li>';
    $('noticias-pag').innerHTML = noticias.length ?
      '· ' + (inicio + 1) + (mostradas > 1 ? '–' + (inicio + mostradas) : '') + ' de ' + noticias.length : '';
    lista.className = '';
  }
  function proximaPagina() {
    if (noticias.length > mostradas) {
      $('lista-noticias').className = 'sumindo';
      setTimeout(function () { inicio += mostradas; mostrarPagina(); }, 650);
    }
  }
  window.addEventListener('orientationchange', function () { setTimeout(mostrarPagina, 500); }, false);

  /* ---------- Dólar ---------- */
  function num(v, casas) { return v.toFixed(casas).replace('.', ','); }
  function mostrarDolar(d) {
    if (!d || typeof d.valor !== 'number') { $('dolar').innerHTML = ''; return; }
    var html = 'Dólar <b>R$ ' + num(d.valor, 2) + '</b>';
    if (typeof d.variacao === 'number') {
      var v = d.variacao;
      html += '<span class="var ' + (v > 0 ? 'sobe' : v < 0 ? 'desce' : '') + '">' +
        (v > 0 ? '▲ ' : v < 0 ? '▼ ' : '') + num(Math.abs(v), 2) + '%</span>';
    }
    $('dolar').innerHTML = html;
  }

  /* ---------- Porta-retratos ---------- */
  // Só dois elementos de imagem, reaproveitados: o Safari antigo tem pouca
  // memória. Ao fechar, as imagens são descarregadas.
  var fotos = [], filaFotos = [], retratosAbertos = false, timerTroca = null, timerFim = null, camadaA = true;
  function proximaFoto() {
    if (!filaFotos.length) {
      filaFotos = fotos.slice(0);
      for (var i = filaFotos.length - 1; i > 0; i--) { // embaralha
        var j = Math.floor(Math.random() * (i + 1)), t = filaFotos[i];
        filaFotos[i] = filaFotos[j]; filaFotos[j] = t;
      }
    }
    return filaFotos.shift();
  }
  function trocarFoto() {
    var url = proximaFoto();
    pegarTexto(url, function (txt) {
      if (!retratosAbertos) return;
      var bits = abrir(txt);
      if (!bits) return;
      var nova = $(camadaA ? 'foto-a' : 'foto-b'), velha = $(camadaA ? 'foto-b' : 'foto-a');
      var img = new Image(), src = 'data:image/jpeg;base64,' + sjcl.codec.base64.fromBits(bits);
      bits = txt = null;
      img.onload = function () {
        img.onload = img.onerror = null;
        if (!retratosAbertos) return;
        nova.style.backgroundImage = 'url("' + src + '")';
        nova.className = 'foto visivel';
        velha.className = 'foto';
        camadaA = !camadaA;
        src = null;
      };
      img.onerror = function () { img.onload = img.onerror = null; };
      img.src = src;
    });
  }
  function abrirRetratos() {
    if (retratosAbertos || !fotos.length || ehNoite) return;
    retratosAbertos = true;
    var r = $('retratos');
    r.className = 'ligado';
    setTimeout(function () { if (retratosAbertos) r.className = 'ligado visivel'; }, 50);
    trocarFoto();
    timerTroca = setInterval(trocarFoto, CONFIG.retratosTrocaSeg * 1000);
    timerFim = setTimeout(fecharRetratos, CONFIG.retratosDuracaoSeg * 1000);
  }
  function fecharRetratos() {
    if (!retratosAbertos) return false;
    retratosAbertos = false;
    clearInterval(timerTroca); clearTimeout(timerFim);
    var r = $('retratos');
    r.className = 'ligado';
    setTimeout(function () {
      if (retratosAbertos) return;
      r.className = '';
      $('foto-a').style.backgroundImage = $('foto-b').style.backgroundImage = 'none';
      $('foto-a').className = $('foto-b').className = 'foto';
    }, 1600);
    return true;
  }

  /* ---------- Senha ----------
     O site é público, mas só mostra a tela de senha: dados.txt e as fotos
     vão cifrados (AES-CCM). A chave sai da senha (PBKDF2, igual ao
     scripts/gerar_dados.py) e fica guardada no iPad. */
  var SAL = 'ipad-antigo-painel', ITERACOES = 20000, CHAVE_LS = 'painelChave';
  var chave = null, aes = null;
  function usarChave(hex) { chave = hex; aes = new sjcl.cipher.aes(sjcl.codec.hex.toBits(hex)); }
  // base64(nonce de 12 bytes + cifrado + etiqueta) -> bits, ou null se a senha não bate
  function abrir(txt) {
    try {
      var b = sjcl.codec.base64.toBits(txt.replace(/\s/g, ''));
      return sjcl.mode.ccm.decrypt(aes, sjcl.bitArray.bitSlice(b, 96), sjcl.bitArray.bitSlice(b, 0, 96), [], 128);
    } catch (e) { return null; }
  }
  function lerChave() { try { return localStorage.getItem(CHAVE_LS); } catch (e) { return null; } }
  function guardarChave(hex) { try { if (hex) localStorage.setItem(CHAVE_LS, hex); else localStorage.removeItem(CHAVE_LS); } catch (e) {} }
  function trancar(msg) {
    chave = aes = null;
    guardarChave(null);
    fecharRetratos();
    document.documentElement.className = 'trancado';
    $('entrada-msg').innerHTML = msg || '';
    $('entrada-botao').disabled = false;
  }
  function entrar(e) {
    if (e) e.preventDefault();
    var senha = $('entrada-senha').value;
    if (!senha) return false;
    $('entrada-botao').disabled = true;
    $('entrada-msg').innerHTML = 'Verificando…';
    // deixa a mensagem aparecer antes da conta (alguns segundos no iPad 2)
    setTimeout(function () {
      var bits = sjcl.misc.pbkdf2(senha, sjcl.codec.utf8String.toBits(SAL), ITERACOES, 128);
      usarChave(sjcl.codec.hex.fromBits(bits));
      pegarTexto('dados.txt', function (txt, data) {
        if (!usarDados(txt, data)) { trancar('Senha incorreta.'); return; }
        guardarChave(chave);
        $('entrada-senha').value = '';
        $('entrada-senha').blur();
        document.documentElement.className = '';
      }, function () { trancar('Sem conexão. Tente de novo.'); });
    }, 50);
    return false;
  }
  $('entrada').onsubmit = entrar;

  /* ---------- Dados (dados.txt, gerado e cifrado pelo GitHub Actions) ---------- */
  function usarDados(txt, cabecalhoData) {
    var bits = abrir(txt), d = null;
    if (bits) { try { d = JSON.parse(sjcl.codec.utf8String.fromBits(bits)); } catch (e) {} }
    if (!d) return false;
    mostrarDados(d, cabecalhoData);
    return true;
  }
  function carregarDados() {
    if (!chave) return;
    pegarTexto('dados.txt', function (txt, data) {
      if (!usarDados(txt, data)) trancar('A senha mudou. Digite a nova.');
    }, function () {
      $('rodape').className = 'alerta';
      $('atualizado').innerHTML = 'sem conexão — tentando de novo';
    });
  }
  function mostrarDados(d, cabecalhoData) {
    var srv = cabecalhoData ? Date.parse(cabecalhoData) : NaN;
    if (!isNaN(srv)) { var dif = srv - Date.now(); ajuste = Math.abs(dif) > 30000 ? dif : 0; }
    if (d.latitude !== undefined) coords = { lat: d.latitude, lon: d.longitude };
    $('cidade').innerHTML = esc(d.cidade || '');
    if (!vivoOk) mostrarTempo(d.tempo);
    mostrarDolar(d.dolar);
    if (d.noticias && d.noticias.length) {
      var primeira = !noticias.length;
      noticias = d.noticias;
      if (primeira) mostrarPagina();
    }
    if (d.fotos) {
      fotos = d.fotos; filaFotos = [];
      // Abrir o endereço com #fotos mostra o porta-retratos logo (para testar)
      if (primeiraVez && location.hash === '#fotos') setTimeout(abrirRetratos, 2000);
    }
    var ger = Date.parse(d.gerado_em);
    var velho = !isNaN(ger) && (agoraMs() - ger) > 3 * 3600000;
    $('rodape').className = velho ? 'alerta' : '';
    $('atualizado').innerHTML = 'notícias ' + haQuanto(d.gerado_em);
    if (primeiraVez) { primeiraVez = false; tempoAoVivo(); }
  }
  var primeiraVez = true;

  tique();
  var guardada = lerChave();
  if (guardada) { usarChave(guardada); document.documentElement.className = ''; carregarDados(); }
  else trancar();
  setInterval(carregarDados, CONFIG.recarregarDadosMin * 60000);
  setInterval(tempoAoVivo, CONFIG.tempoAoVivoMin * 60000);
  setInterval(proximaPagina, CONFIG.trocaNoticiasSeg * 1000);
  setInterval(abrirRetratos, CONFIG.retratosACadaMin * 60000);
  setTimeout(function () { location.reload(); }, CONFIG.recarregarPaginaHoras * 3600000);
})();
