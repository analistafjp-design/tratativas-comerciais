# Impacto do Cadastro

Painel simples para mostrar o que as tratativas do cadastro trazem de valor. Para cada mês: **novas economias**, **trocas de categoria**, o **valor que entra na próxima fatura cheia** e o **total até dezembro**. No topo, o resumo do ano.

Endereço depois de publicado: `https://analistafjp-design.github.io/tratativas-comerciais/`

> **Dados publicados:** tabela `Resultados - 2026.xlsx` (frente Cadastro, até 08/10/2026), com o cálculo **corrigido** (tarifas reais) e **sem o 2× de água + esgoto**, porque ainda falta o cruzamento com a base de clientes (passo 2). Dados fictícios de teste ficam só em `exemplo/`.

## 1. Publicar no GitHub Pages (uma vez)

1. No GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Leve estas alterações para a branch `main`. A cada push na `main`, o fluxo `.github/workflows/pages.yml` publica a pasta `site/`.

> Pages em repositório **privado** exige plano pago do GitHub (Pro/Team). No plano gratuito o repositório precisa ser público. O que é publicado são só totais por mês e localidade, sem cliente, matrícula ou endereço.

## 2. Atualizar com os dados reais

1. No Power BI, exporte a tabela **TRATATIVAS** (Exportar dados → `.xlsx` ou `.csv`). Só as colunas originais são necessárias: `Hora de conclusão`, `DE:`, `PARA:`, `ANTERIOR`, `ATUAL`, `QUANTIDADE`, `MATRICULA S/ DIGITO` (e, opcionalmente, `TIPO DE ECONOMIA` e `FRENTE DE SERVIÇO`).
2. Exporte a base de clientes com as colunas `NUM_LIGACAO`, `CIDADE` e `TIPO_FATURAMENTO` ("AGUA" ou "AGUA E ESGOTO"), de **um mês completo** (ex.: `09/2026`). O tipo de faturamento de uma ligação não muda de um mês para o outro, então um mês basta. **Atenção ao limite do sistema:** a exportação corta em 150.000 linhas (aviso *"Exported data exceeded the allowed volume"* no rodapé) e vem ordenada por ligação, então as ligações de número mais alto ficam de fora. O script informa quantas tratativas achou na base; o painel mostra essa cobertura no rodapé.
3. Rode no seu computador (precisa de Python 3 e `pip install openpyxl`):

```bash
python scripts/build_data.py "Resultados - 2026.xlsx" "FORMULÁRIO DE CADASTRO - editado.xlsx" --frente Cadastro --clientes "Consulta Cliente.xlsx"
```

A planilha tem duas frentes de serviço (Cadastro e Bairro Legal – VCG): use `--frente Cadastro` para o time do cadastro. Com mais de um arquivo de tratativas, **o último vale por todo o período dele**: o que o anterior tem a partir da primeira data do último é substituído, inclusive as linhas que você apagou da cópia editada. Serve para usar a cópia editada do formulário (nomes padronizados, quantidades em número; hoje cobre de abril em diante) por cima do Resultados original; o que vem antes (ex.: março) continua vindo do primeiro arquivo. O script mostra no terminal o resultado de cada mês. Depois envie `site/data/summary.json` para a `main`. **Não envie as planilhas**: `.xlsx`, `.xls`, `.csv` e `.pbix` estão no `.gitignore`.

**Como conferir com o Power BI:** rode com `--como-powerbi`, que reproduz as particularidades do relatório (veja abaixo). Com os dados de 2026, SET/2026 bate ao centavo: R$ 6.263,06. Sobre a coluna `líquido s/2×`: o relatório atual não aplica água + esgoto (2×). A coluna **`líquido s/2×`** do terminal é o resultado sem o 2× e deve bater com o rodapé do relatório (Julho, Agosto, Setembro…), salvo as diferenças listadas abaixo. A coluna **`líquido`** é o valor do painel, já com o 2×.

Opções úteis: `--de 2026-03 --ate 2026-09` (período), `--frente Cadastro` (só uma FRENTE DE SERVIÇO), `--col-ligacao`, `--col-localidade` e `--col-faturamento` (se o script não reconhecer as colunas da base de clientes). `python scripts/build_data.py --help` lista tudo.

Para ver o formato esperado e testar o painel: `python scripts/gerar_exemplo.py` cria dados fictícios em `exemplo/` (use `--exemplo` ao gerar o painel com eles, para exibir a faixa de aviso). Pré-visualização local: `python -m http.server 8000 -d site`.

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
- **Água + esgoto (valor × 2)**: pelo `TIPO_FATURAMENTO` **de cada ligação** na base de clientes (cruzamento `NUM_LIGACAO` = `MATRICULA S/ DIGITO`). Não vale dobrar a cidade inteira: na amostra exportada, só 12% das ligações de Cordeiro e 23% das de Miracema faturam água e esgoto (em Aperibé, 90%). Tratativas cuja ligação não está na base são calculadas só com água. Se a base não tiver a coluna de faturamento, o script usa a regra por município (`DOUBLE_CITIES`: Cordeiro, Miracema e Aperibé).
- **Valor de uma troca de categoria = tarifa nova − tarifa anterior**, nunca a tarifa cheia. Ex.: Social (R$ 30,12) → Residencial (R$ 85,41) = R$ 55,29 por mês; o inverso é −R$ 55,29. Esse valor entra cheio a partir da fatura do mês seguinte.
- **Tarifas oficiais** (por economia/mês): Residencial R$ 85,41 · Comercial R$ 443,56 · Industrial R$ 613,16 · Pública R$ 129,15 · Pequeno comércio R$ 221,78 · Social R$ 30,12 · Comércio popular R$ 60,24. Para mudar, edite `TARIFFS_CENTS` em `scripts/build_data.py` e gere de novo. (A tabela `Tarifas` do modelo Power BI tem 1 centavo a mais em Comercial, Industrial e Pública; só o modo `--como-powerbi` a usa.)
- **Equivalências de categoria:** CADÚNICO = Social (então "CADÚNICO → Social" não é troca) e entidade sem fins lucrativos = Pública.
- **Texto no lugar do número.** Quando o operador escreve a alteração em texto no campo `QUANTIDADE` (ex.: `DE 1 RES. P/ 1 RES. E 2 COM.`), vale a mesma convenção das conversões feitas à mão no formulário: **quantidade = economias que ficaram na categoria `ATUAL`**, e o valor é quantidade × (tarifa atual − tarifa anterior). Ex.: `DE 1 RES. P/ 5 COM.` com Residencial → Comercial = 5 × (443,56 − 85,41). Se não der para seguir a convenção (ex.: `ANTERIOR` = `ATUAL`), o texto é lido como antes → depois (troca de categoria + economia nova ou retirada). Texto escrito direto nos campos `DE:`/`PARA:` e campos com duas categorias (ex.: `6 RES. E 1 COM.`) também são lidos como antes → depois. Texto sem número ou sem categoria (ex.: `DE 2 ECONOMIAS PARA 1 ECONOMIA`) fica fora dos valores e aparece como pendência. Abreviações reconhecidas: `RES`, `RS`, `COM`, `PEQ`, `SOC`, `NORMAIS`.
- **DE:/PARA: com categoria diferente** (ex.: `1 RESIDENCIAL` → `18 COMERCIAL`): só a economia que trocou de categoria desconta a anterior; o que sobra é economia nova (ou retirada) pela tarifa cheia. Valor = depois × tarifa − antes × tarifa, ou seja, 18 × 443,56 − 85,41. Se a quantidade não muda (`1 RESIDENCIAL` → `1 COMERCIAL`), é uma troca de categoria. O relatório valoriza o primeiro caso como diferença × tarifa cheia do PARA (17 × 443,57) e o segundo como R$ 0.
- **Quem manda é o número, não a marcação do Forms.** De 2 para 1 residência é decremento (perda), mesmo que o operador tenha marcado "Incremento".
- **Linhas idênticas** (mesmo `Id` e todas as colunas iguais, cópias da exportação) contam uma vez.

### Onde o painel difere do Power BI

- **Água + esgoto (2×)** não existe no relatório atual: é o cruzamento novo com a base de clientes.
- **Comércio popular** vira Comercial no relatório (o texto contém "COM" e a tabela de tarifas não tem a categoria). Uma troca P. comércio → Comércio popular entra como ganho de R$ 221,79 no relatório; no painel é uma perda de R$ 161,54 (R$ 60,24 − R$ 221,78).
- **Pública** nas trocas de categoria vale R$ 0 no relatório ("Publica" sem acento não acha a tarifa "PÚBLICA"). No painel vale R$ 129,15.
- **Incremento de economia** só entra no relatório se o Forms marcar "Incremento" em `QUAL FOI A ALTERAÇÃO DE ECONOMIA?`. Um aumento marcado como "Decremento" não aparece em nenhuma tabela. O painel calcula pela diferença de quantidade.
- Com `--como-powerbi` o script reproduz esses comportamentos (e também ignora texto no lugar do número, campos com duas categorias e linhas repetidas) para conferência.
- **Textos no lugar do número, campos com duas categorias e linhas repetidas** não entram no relatório. No painel entram, e é isso que mais separa os números dos dois (em agosto, por exemplo, são dezenas de tratativas escritas em texto).
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
