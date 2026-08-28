# Teste de câmera Bambu Cloud

Este teste consulta `POST /v1/iot-service/api/user/ttcode` usando o token já autenticado e o `dev_id` da impressora.

O Worker não devolve ao navegador UID, AuthKey, senha ou TTCode. A interface recebe apenas indicadores booleanos e os nomes dos campos retornados, suficientes para confirmar se a conta/impressora oferece uma sessão P2P de câmera pela nuvem.

Se o teste indicar sessão disponível, a próxima etapa é implementar o transporte/player P2P compatível com a A1.
