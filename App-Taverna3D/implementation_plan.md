# Plano de Implementação: Taverna do 3D (Novo Aplicativo)

Criação de uma aplicação web/PWA exclusiva, personalizada para a **Taverna do 3D**, preservando todos os arquivos do projeto de referência e trazendo uma experiência sob medida.

---

## 🎨 Identidade Visual e Estilo ("Taverna Medieval Moderna")
* **Paleta de Cores**:
  * Fundo principal: Marrom escuro profundo e couro envelhecido (`#14110F` / `#1C1815`)
  * Superfícies e Cards: Madeira nobre / Carvalho escuro com toques de vidro fosco (`#26201B` / `#332B24`)
  * Destaques e Botões Primários: Âmbar dourado / Ouro envelhecido (`#D97706` / `#F59E0B`)
  * Tipografia e Textos: Bege pergaminho suave (`#F5EBE1` e `#D6C7B2`)
  * Cores de Status: Verde musgo/esmeralda (Aprovado/Lucro), Vermelho brasa (Alerta/Gasto), Azul runa (Pronto/Em trânsito).
* **Tipografia**: Moderna e nítida (Google Fonts *Outfit* / *Cinzel* suave nos títulos + *Inter* para leitura e números tabulares).

---

## ⚙️ Especificações & Presets da Oficina
1. **Impressora Padrão**:
   * **Bambu Lab A1** configurada como padrão (consumo médio real em Watts, desgaste de bico/correias e custo-hora).
2. **Material Base**:
   * **PLA** já pré-cadastrado como filamento principal (com campos para cores, marcas e custo por carretel de 1kg).
3. **Canais de Venda Multicanal**:
   * **Venda Direta / WhatsApp** (0% taxa de marketplace).
   * **Shopee** (comissão percentual + taxa fixa por item + frete).
   * **TikTok Shop** (comissão padrão TikTok Shop Brasil + taxa de processamento de pagamento).
4. **Armazenamento e Nuvem**:
   * Funciona 100% offline via `localStorage` e `IndexedDB`.
   * Módulo nativo de sincronização em nuvem via **Supabase** (backup automático e preparação para APIs).

---

## 📁 Estrutura de Arquivos Proposta

O novo projeto será criado na pasta `App-Taverna3D/` sem alterar os arquivos originais:

```
App-Taverna3D/
├── index.html              # Aplicação principal unificada da Taverna do 3D
├── manifest.json           # Manifesto PWA para instalar no celular/computador
├── service-worker.js       # Suporte a funcionamento offline
├── supabase-schema.sql     # Script SQL para o banco na nuvem Supabase
└── assets/                 # Ícones temáticos da Taverna do 3D (192px, 512px, logo)
```

---

## 🚀 Módulos do Aplicativo

### 1. Calculadora de Precificação Multicanal
* **Custo Real de Fabricação**:
  * Peso em gramas de PLA (ou outros filamentos).
  * Tempo de impressão em horas e minutos.
  * Energia elétrica da **Bambu Lab A1** (Watts × tempo × tarifa da luz).
  * Depreciação da máquina (modo fixo ou progressivo).
  * Margem de falhas, acabamento e custos operacionais.
* **Cards de Preço em Tempo Real**:
  * 🏷️ **Preço Direto (PIX / WhatsApp / Dinheiro)** com a margem desejada.
  * 🧡 **Preço Shopee** (calculado com a comissão e taxas da Shopee).
  * 🎵 **Preço TikTok Shop** (calculado com a comissão e taxas do TikTok Shop).

### 2. Gestão de Pedidos (Kanban & Lista)
* Visualização em Lista organizada e Quadro Kanban arrastável.
* Tags visuais de canais: **WhatsApp**, **Shopee**, **TikTok Shop**, **Balcão**.
* Status de produção: *Novo ➔ Aguardando Pagamento ➔ A Produzir ➔ Em Produção ➔ Pronto ➔ Enviado ➔ Concluído*.
* Adição manual rápida com fotos da peça.

### 3. Orçamentos da Taverna do 3D
* Geração de propostas comerciais personalizadas com o nome **Taverna do 3D**.
* Envio em 1 clique para WhatsApp com formatação elegante e profissional.
* Botão para converter orçamento aprovado diretamente em pedido na fila de impressão.

### 4. Gestão de Filamentos & Estoque
* Tabela de carretéis (PLA, PETG, etc.), marcas, cores, valor do kg e saldo em estoque.

### 5. Nuvem / Supabase & Backup
* Conexão simples com o Supabase para sincronização em tempo real entre celular e computador.
* Botões de exportação/importação manual em JSON.

---

## 🧪 Plano de Verificação

1. **Validação Visual & Responsividade**:
   * Testar a interface em formato mobile (iPhone/Android) e desktop (PC).
   * Validar a harmonia das cores de taverna (marrom, bege, âmbar).
2. **Validação dos Cálculos Financeiros**:
   * Simular peças em PLA na Bambu Lab A1 e verificar se o cálculo Direto, Shopee e TikTok Shop embutem corretamente as taxas.
3. **Validação dos Pedidos e Orçamentos**:
   * Criar um orçamento, gerar a mensagem de WhatsApp, converter em pedido e mover os cards no Kanban.
4. **Validação PWA & Offline**:
   * Verificar funcionamento do Service Worker e persistência local.
