/**
 * ===================================================================
 *  TAVERNA DO 3D - CALCULADORA 3D WORKER & BAMBU LAB CLOUD RELAY
 * ===================================================================
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Tratar CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // =========================================================
    //  ROTAS DA API DA BAMBU LAB
    // =========================================================

    // 1. LOGIN NA BAMBU LAB CLOUD
    if (url.pathname === '/api/bambu/login' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const { account, password, tfa_code } = body;

        if (!account || !password) {
          return jsonResponse({ success: false, error: 'E-mail e senha da Bambu Lab são obrigatórios.' }, 400);
        }

        const payload = {
          account: account.trim(),
          password: password.trim(),
        };
        if (tfa_code) payload.tfa_code = String(tfa_code).trim();

        const bambuRes = await fetch('https://api.bambulab.com/v1/user-service/user/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'BambuStudio/01.09.03.50',
            'Accept': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        const data = await bambuRes.json().catch(() => ({}));

        if (!bambuRes.ok || !data.accessToken) {
          // Se precisar de 2FA / código de e-mail
          if ((data.message && data.message.includes('2fa')) || data.tfa_code_required) {
            return jsonResponse({
              success: false,
              require2fa: true,
              message: 'Código de verificação (2FA / E-mail) requerido. Digite o código recebido no seu e-mail.',
            }, 200);
          }
          return jsonResponse({
            success: false,
            error: data.message || 'Falha ao autenticar na Bambu Lab. Verifique seu e-mail e senha.',
          }, 401);
        }

        return jsonResponse({
          success: true,
          token: data.accessToken,
          userId: data.userId || data.uid || '',
          username: data.username || data.name || account.split('@')[0],
          email: account,
        });
      } catch (err) {
        return jsonResponse({ success: false, error: 'Erro de conexão com o servidor da Bambu Lab: ' + err.message }, 500);
      }
    }

    // 2. LISTAR IMPRESSORAS VINCULADAS (BAMBU A1, ETC)
    if (url.pathname === '/api/bambu/devices' && (request.method === 'GET' || request.method === 'POST')) {
      try {
        let token = request.headers.get('Authorization')?.replace('Bearer ', '')?.trim();
        if (!token && request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          token = body.token;
        }

        if (!token) {
          return jsonResponse({ success: false, error: 'Token de autenticação não fornecido.' }, 401);
        }

        const bambuRes = await fetch('https://api.bambulab.com/v1/iot-service/api/user/bind', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'BambuStudio/01.09.03.50',
            'Accept': 'application/json',
          },
        });

        const data = await bambuRes.json().catch(() => ({}));

        if (!bambuRes.ok) {
          return jsonResponse({ success: false, error: data.message || 'Erro ao buscar impressoras.' }, bambuRes.status);
        }

        const rawDevices = data.devices || [];
        const devices = rawDevices.map(d => ({
          dev_id: d.dev_id || d.devId || d.sn || '',
          name: d.name || d.dev_name || 'Bambu Lab A1',
          model: d.dev_model_name || d.dev_product_name || 'A1',
          online: Boolean(d.online),
          access_code: d.dev_access_code || '',
          nozzle_diameter: d.nozzle_diameter || 0.4,
          is_printing: d.print_status === 'RUNNING' || d.print_status === 'PRINTING',
          print_status: d.print_status || (d.online ? 'IDLE' : 'OFFLINE'),
        }));

        return jsonResponse({
          success: true,
          devices,
        });
      } catch (err) {
        return jsonResponse({ success: false, error: 'Erro ao comunicar com Bambu Cloud: ' + err.message }, 500);
      }
    }

    // 3. CONSULTAR TELEMETRIA / STATUS DA IMPRESSORA
    if (url.pathname === '/api/bambu/telemetry' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const { token, dev_id } = body;

        if (!token || !dev_id) {
          return jsonResponse({ success: false, error: 'Token e ID da impressora são obrigatórios.' }, 400);
        }

        // Consulta info do dispositivo na nuvem
        const statusRes = await fetch(`https://api.bambulab.com/v1/iot-service/api/user/device/version?dev_id=${dev_id}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'BambuStudio/01.09.03.50',
          }
        });

        const statusData = await statusRes.json().catch(() => ({}));

        return jsonResponse({
          success: true,
          dev_id,
          raw: statusData,
        });
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }

    // =========================================================
    //  SERVIÇO DE ARQUIVOS ESTÁTICOS DO FRONTEND
    // =========================================================
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return new Response('Calculadora Taverna do 3D Online.', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS_HEADERS }
    });
  }
};
