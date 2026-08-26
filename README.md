# Taverna do 3D · Calculadora de Impressão 3D & Gestão

Sistema completo de precificação, gestão de custos, catálogo de filamentos/resinas, controle de pedidos e orçamentos para impressão 3D (FDM & SLA).

## 🚀 Funcionalidades

- **Calculadora FDM & SLA / Resina**: Precificação precisa considerando filamento/resina, depreciação de máquina, energia elétrica, falhas e lucro.
- **Gestão de Filamentos & Resinas**: Controle de estoque, preços por kg/litro e cores.
- **Parque de Impressoras**: Cadastro de máquinas (FDM e Resina) com consumo energético e custo/hora de depreciação.
- **Catálogo de Serviços & Adicionais**: Pintura, acabamento, montagem, embalagens personalizadas e taxas extras.
- **Gestão de Clientes & Orçamentos**: Geração rápida de orçamentos detalhados prontos para envio.
- **Sincronização em Nuvem**: Suporte a banco de dados Supabase com sincronização em tempo real.
- **PWA (Progressive Web App)**: Funciona offline e pode ser instalado no celular e desktop.

## 🛠️ Tecnologias

- **Frontend**: HTML5, CSS3 moderno (Glassmorphism, tema dark taverna medieval), JavaScript Vanilla.
- **Ícones & Fontes**: Phosphor Icons, Google Fonts (Cinzel, Outfit, Inter).
- **Backend / Sincronização**: Supabase (PostgreSQL).

## 📂 Estrutura do Projeto

- `index.html`: Redirecionamento e entrada da aplicação.
- `App-Taverna3D/`:
  - `index.html`: Aplicação principal.
  - `assets/`: Logos, ícones PWA e imagens de fundo.
  - `manifest.json` & `service-worker.js`: Configuração PWA para uso offline.
  - `supabase-schema.sql`: Script SQL para configuração das tabelas no Supabase.

---
Desenvolvido para a **Taverna do 3D**.
