# Impacto do Cadastro

Painel simples para mostrar o que as tratativas do cadastro trazem de valor. Para cada mês: **novas economias**, **trocas de categoria**, o **valor que entra na próxima fatura cheia** e o **total até dezembro**. No topo, o resumo do ano.

Endereço depois de publicado: `https://analistafjp-design.github.io/tratativas-comerciais/`

> **Os dados que vêm neste repositório são de exemplo (fictícios)** e aparecem com uma faixa de aviso no topo. Gere o painel com a sua exportação antes de compartilhar o endereço (passo 2).

## 1. Publicar no GitHub Pages (uma vez)

1. No GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Leve estas alterações para a branch `main`. A cada push na `main`, o fluxo `.github/workflows/pages.yml` publica a pasta `site/`.

> Pages em repositório **privado** exige plano pago do GitHub (Pro/Team). No plano gratuito o repositório precisa ser público. O que é publicado são só totais por mês e localidade, sem cliente, matrícula ou endereço.

## 2. Atualizar com os dados reais

1. No Power BI, exporte a tabela **TRATATIVAS** (Exportar dados → `.xlsx` ou `.csv`). Só as colunas originais são necessárias: `Hora de conclusão`, `DE:`, `PARA:`, `ANTERIOR`, `ATUAL`, `QUANTIDADE`, `MATRICULA S/ DIGITO` (e, opcionalmente, `TIPO DE ECONOMIA` e `FRENTE DE SERVIÇO`).
2. Tenha em mãos a base de clientes que liga **matrícula → localidade** (usada para o cálculo de água + esgoto).
3. Rode no seu computador (precisa de Python 3 e `pip install openpyxl`):

```bash
python scripts/build_data.py "Resultados - 2026.xlsx" --frente Cadastro --clientes "Consulta Cliente.xlsx"
```

A planilha tem duas frentes de serviço (Cadastro e Bairro Legal – VCG): use `--frente Cadastro` para o time do cadastro. O script mostra no terminal o resultado de cada mês. Depois envie `site/data/summary.json` para a `main`. **Não envie as planilhas**: `.xlsx`, `.xls`, `.csv` e `.pbix` estão no `.gitignore`.

**Como conferir com o Power BI:** rode com `--como-powerbi`, que reproduz as particularidades do relatório (veja abaixo). Com os dados de 2026, SET/2026 bate ao centavo: R$ 6.263,06. Sobre a coluna `líquido s/2×`: o relatório atual não aplica água + esgoto (2×). A coluna **`líquido s/2×`** do terminal é o resultado sem o 2× e deve bater com o rodapé do relatório (Julho, Agosto, Setembro…), salvo as diferenças listadas abaixo. A coluna **`líquido`** é o valor do painel, já com o 2×.

Opções úteis: `--de 2026-03 --ate 2026-09` (período), `--frente CADASTRO` (só uma FRENTE DE SERVIÇO), `--col-ligacao` e `--col-localidade` (se o script não reconhecer as colunas da base de clientes). `python scripts/build_data.py --help` lista tudo.

Para ver o formato esperado e testar o painel: `python scripts/gerar_exemplo.py` cria dados fictícios em `exemplo/`. Pré-visualização local: `python -m http.server 8000 -d site`.

## Como o valor é calculado

Igual às medidas do modelo. O resultado do mês é a **soma das quatro tabelas**:

| Tabela | Colunas | Valor |
| --- | --- | --- |
| Incremento de economia (`PARA` > `DE`) | `DE:` e `PARA:` (ex.: `2 RESIDENCIAL` → `3 RESIDENCIAL`) | mesma categoria: diferença × tarifa. Categoria diferente: diferença × (tarifa PARA − tarifa DE) |
| Decremento de economia (`PARA` < `DE`) | `DE:` e `PARA:` | mesma categoria: diferença × tarifa. Categoria diferente: diferença × (tarifa DE − tarifa PARA) |
| Incremento de categoria | `ANTERIOR`, `ATUAL`, `QUANTIDADE` | `QUANTIDADE` × (tarifa atual − tarifa anterior), quando positivo |
| Decremento de categoria | `ANTERIOR`, `ATUAL`, `QUANTIDADE` | idem, quando negativo. Categoria sem tarifa ("Outros") vale R$ 0 |

- **Ganhos** = incrementos; **Perdas** = decrementos. **Resultado do mês = ganhos − perdas.**
- "Novas economias" e "Trocas de categoria" são os totais das tabelas de **incremento** do relatório. Os decrementos entram só no valor (como perdas).
- Mês de referência: `Hora de conclusão`. A triagem é feita no fim do mês, então a primeira fatura cheia é a do **mês seguinte**.
- **Até dezembro** = resultado do mês × meses restantes após o mês da tratativa (julho → ago a dez = 5). O resumo do ano soma isso de todos os meses.
- **Água + esgoto (valor × 2)**: Cordeiro, Miracema e Aperibé, definidos em `DOUBLE_CITIES` no script. Os demais pagam só água. É uma regra por município; se a base de clientes passar a ter o tipo de faturamento por ligação, o ideal é usar esse campo.
- **Tarifas** (por economia/mês): Residencial R$ 85,41 · Comercial R$ 443,57 · Industrial R$ 613,17 · Pública R$ 129,16 · Pequeno comércio R$ 221,78 · Social R$ 30,12 · Comércio popular R$ 60,24. Comercial, Industrial e Pública seguem a tabela `Tarifas` do modelo, que é o que o relatório usa (ex.: 2 × 443,57 = R$ 887,14). A lista de tarifas informada em texto tem 1 centavo a menos nessas três (443,56 / 613,16 / 129,15). Para mudar, edite `TARIFFS_CENTS` em `scripts/build_data.py` e gere de novo.

### Onde o painel difere do Power BI

- **Água + esgoto (2×)** não existe no relatório atual: é o cruzamento novo com a base de clientes.
- **Comércio popular** vira Comercial no relatório (o texto contém "COM" e a tabela de tarifas não tem a categoria). Uma troca P. comércio → Comércio popular entra como ganho de R$ 221,79 no relatório; no painel é uma perda de R$ 161,54 (R$ 60,24 − R$ 221,78).
- **Pública** nas trocas de categoria vale R$ 0 no relatório ("Publica" sem acento não acha a tarifa "PÚBLICA"). No painel vale R$ 129,16.
- **Incremento de economia** só entra no relatório se o Forms marcar "Incremento" em `QUAL FOI A ALTERAÇÃO DE ECONOMIA?`. Um aumento marcado como "Decremento" não aparece em nenhuma tabela. O painel calcula pela diferença de quantidade.
- Com `--como-powerbi` o script reproduz esses três comportamentos para conferência.
- **Linha com duas categorias no mesmo campo** (ex.: `1 RES E 1 COM` em `DE:`) fica fora dos valores e aparece como pendência no painel.
- **`QUANTIDADE` escrita como texto** (ex.: `DE 1 RES. SOCIAL P/ 2 RES. NORMAIS`) fica fora dos valores, como no relatório, e aparece como pendência. É preciso corrigir o preenchimento no Forms para essas linhas entrarem.
- **Ganhos / Perdas / Saldo Real** no modelo são números digitados (`2.94542`, `-2.37509`, `570.33`), não cálculo. O painel calcula esses valores a partir das linhas.

O script também avisa quando há categorias não reconhecidas (tratadas como "Outros", R$ 0) e as maiores tratativas individuais, para você conferir erros de digitação.

## Estrutura

```
site/                     painel estático (index.html, styles.css, app.js)
site/data/summary.json    totais por mês, localidade e (de → para) (gerado, sem dados de cliente)
scripts/build_data.py     gera o summary.json a partir da exportação
scripts/gerar_exemplo.py  dados fictícios para teste
tests/                    python -m unittest discover -s tests
.github/workflows/        publicação no Pages
```

Os testes incluem a reprodução das quatro tabelas de SET/2026 do relatório (R$ 7.207,48 + R$ 8.653,13 − R$ 1.639,31 − R$ 7.958,24 = R$ 6.263,06).

O valor é **potencial de faturamento recorrente**, não arrecadação comprovada nem conferência de faturas emitidas.
