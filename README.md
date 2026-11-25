# iPad Antigo — painel de parede

Transforma um iPad 2 (iOS 9, Safari 9) em um painel de parede com **relógio, data,
tempo (agora, próximas horas e 6 dias) e notícias do dia**.

- Página estática, JavaScript ES5 puro — roda no Safari do iOS 9.
- O GitHub Actions baixa tempo ([Open-Meteo](https://open-meteo.com), sem chave)
  e notícias (RSS) a cada 30 min e grava `data.json` junto da página.
  O iPad lê esse arquivo do mesmo site, então não esbarra em CORS nem em
  certificados que o iOS 9 não conhece.
- O iPad também tenta buscar o tempo direto no Open-Meteo a cada 15 min;
  se não conseguir, usa o do `data.json`.
- Escurece sozinho das 23h às 6h. **Toque** na tela para alternar claro/escuro;
  **toque duas vezes** para voltar ao automático.
- O relógio não depende do fuso do iPad: usa a hora do servidor e o fuso
  da cidade (o iOS 9 ainda acha que o Brasil tem horário de verão).
- Recarrega a página a cada 6 h para o Safari antigo não acumular memória.

## Configurar

Edite [`config.json`](config.json): cidade, latitude/longitude e os feeds RSS.
Latitude e longitude da sua cidade: procure em https://open-meteo.com/en/docs.

Ajustes da tela (tempo de troca das notícias, horário noturno) ficam no topo de
[`app.js`](app.js), no objeto `CONFIG`.

## Publicar (uma vez só)

1. Em **Actions**, rode o workflow **Painel do iPad** (ou espere o próximo ciclo).
   Ele cria o branch `painel-site`.
2. Em **Settings → Pages**, escolha *Deploy from a branch* → `painel-site` / `(root)`.
3. O painel fica em https://jppaivasilva.github.io/iPad-Antigo/

## Preparar o iPad

**Certificado (obrigatório no iOS 9).** O GitHub Pages usa certificados da
Let's Encrypt, cuja raiz (ISRG Root X1) o iOS 9 não conhece. Instale-a uma vez:
no **Safari** do iPad abra `http://x1.i.lencr.org/` (link oficial da Let's
Encrypt, sem o "s") → **Instalar** → digite o código → **Instalar** → **OK**.
Impressão digital SHA-256: `96:BC:EC:06:…:BD:DF:08:C6`.

0. Libere espaço (**Ajustes → Geral → Uso**): com 0 bytes livres o Safari
   pode fechar sozinho ou não salvar o ícone.
1. Abra o endereço no Safari e toque em **Compartilhar → Adicionar à Tela de Início**.
   Abrindo pelo ícone, a página ocupa a tela inteira, sem barra do Safari.
2. **Ajustes → Geral → Bloqueio Automático → Nunca** (a tela não apaga).
3. Opcional: **Ajustes → Geral → Acessibilidade → Acesso Guiado** para travar o
   iPad só no painel (três cliques no botão Início para ativar).
4. Deixe na tomada e, se puder, abaixe o brilho.

## Testar no computador

```sh
python3 scripts/gerar_dados.py   # gera data.json
python3 -m http.server 8000      # abra http://localhost:8000
```
