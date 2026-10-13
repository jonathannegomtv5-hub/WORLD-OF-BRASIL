# World of Pixalia — Beta (site + servidor)

Pacote completo: **site** (`public/index.html`, tela de login/criar conta + o jogo) e **servidor** (`server.js`: contas, saves, multiplayer).

## Rodar no seu computador
```
npm install
npm start
```
Abra http://localhost:3000 (no celular, na mesma rede Wi-Fi: http://IP-DO-PC:3000).

## Colocar online (Render.com — grátis)
1. Suba esta pasta para um repositório no GitHub.
2. No Render: **New → Web Service** → escolha o repositório.
3. Build Command: `npm install` · Start Command: `npm start`.
4. Quando o deploy terminar, o link `https://seu-app.onrender.com` é o **link de convite**: envie para os testers. Há também o botão "Copiar link de convite" na tela inicial.

### Salvar contas de forma permanente (importante)
O servidor grava as contas em `data/users.json`. No plano grátis do Render o disco é apagado a cada novo deploy/reinício.
- Crie um **Disk** no Render (plano pago), monte em `/var/data` e defina a variável de ambiente `DATA_DIR=/var/data`.
- Ou faça backup periódico do arquivo `data/users.json`.

## O que o beta tem
- Criar conta / entrar (senha com scrypt), sessão salva no navegador, progresso salvo a cada 5 s e ao fechar.
- Jogadores no mesmo mapa se veem em tempo real; chat do mapa e chat global (`/g mensagem`); troca com confirmação dos dois lados; Sacerdote cura e abençoa o grupo de verdade.
- 10 mapas + Abismo Infinito (andares sem fim), lojas de poções/equipamentos, pergaminho de retorno, drops por raridade.

## Limitações conhecidas do beta (honestidade)
- Os **monstros e os drops são calculados no navegador de cada jogador** (não são compartilhados). Dois jogadores se veem, conversam, trocam e se curam, mas cada um luta contra a sua própria cópia dos monstros.
- O **inventário e o ouro são confiados ao cliente** (há só uma checagem básica de salto de nível). Antes de lançar ao público, o ideal é mover combate, drops, lojas e trocas para o servidor.
- Sem recuperação de senha. Para remover/resetar uma conta, edite `data/users.json`.
