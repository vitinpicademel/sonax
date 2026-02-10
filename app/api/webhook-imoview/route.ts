import { NextRequest, NextResponse } from 'next/server';

const IMOVIEW_BASE_URL = 'https://api.imoview.com.br';

// Função de higienização de telefone
function cleanPhoneNumber(phone: string): string {
  if (!phone) return '';

  console.log(`Telefone original: ${phone}`);

  // Remover todos os caracteres que não sejam números
  let cleaned = phone.replace(/\D/g, '');

  console.log(`Após remover caracteres não numéricos: ${cleaned}`);

  // Lógica de DDD Brasil: remover código do país (55) se presente
  if (cleaned.length >= 12 && cleaned.startsWith('55')) {
    cleaned = cleaned.substring(2);
    console.log(`Após remover código do país (55): ${cleaned}`);
  }

  console.log(`Telefone final limpo: ${cleaned}`);
  return cleaned;
}

// Extrai telefone de vários campos possíveis do objeto retornado pela Imoview
function extrairTelefoneGenerico(data: any): string | null {
  if (!data || typeof data !== 'object') return null;

  // Se vier um objeto cliente dentro
  if (data.cliente) {
    const c = data.cliente;
    const telCliente =
      c.celular ||
      c.telefone ||
      c.fone ||
      c.phone ||
      c.telefone1 ||
      c.telefone2 ||
      (Array.isArray(c.telefones) && c.telefones[0]) ||
      c.contato;
    if (telCliente) return telCliente as string;
  }

  // Campos diretos comuns nos retornos da Imoview
  return (
    data.telefonelead || // Campo específico de atendimentos de leads
    data.celular ||
    data.telefone ||
    data.fone ||
    data.phone ||
    data.telefone1 ||
    data.telefone2 ||
    (Array.isArray(data.telefones) && data.telefones[0]) ||
    data.contato ||
    data.telefone_principal ||
    data.telefone_secundario ||
    null
  );
}

// Seleciona a fila Sonax com base em regras de valor do imóvel (aproximação)
// MCMV: até ~300k, Econômico: até ~700k, acima disso: Alto Padrão
function selecionarFilaSonaxPorPerfil(atendimento: any): string | null {
  const filaDefault = process.env.SONAX_QUEUE_ID || null;
  const filaAltoPadrao = process.env.SONAX_QUEUE_ALTO_PADRAO || null;
  const filaMcmv = process.env.SONAX_QUEUE_MCMV || null;
  const filaEconomico = process.env.SONAX_QUEUE_ECONOMICO || null;

  const textoPerfil: string = String(
    atendimento?.resumoPerfil || atendimento?.resumo || ''
  );

  const matches = Array.from(textoPerfil.matchAll(/R\$\s*([\d\.\,]+)/g));
  if (!matches.length) {
    return filaDefault;
  }

  const valores = matches
    .map((m) => {
      const num = m[1].replace(/\./g, '').replace(',', '.');
      const parsed = parseFloat(num);
      return Number.isNaN(parsed) ? null : parsed;
    })
    .filter((v): v is number => v !== null);

  if (!valores.length) return filaDefault;

  const valorMedio =
    valores.length === 1
      ? valores[0]
      : (valores[0] + valores[valores.length - 1]) / 2;

  // Limiares aproximados – ajuste conforme sua estratégia de negócio
  if (valorMedio <= 300000 && filaMcmv) return filaMcmv;
  if (valorMedio <= 700000 && filaEconomico) return filaEconomico;
  if (filaAltoPadrao) return filaAltoPadrao;

  return filaDefault;
}

// Autentica na Imoview para obter codigoacesso (obrigatório para endpoints App_)
async function obterCodigoAcesso(imoviewKey: string) {
  const email = process.env.IMOVIEW_EMAIL;
  const senhaMd5 = process.env.IMOVIEW_PASSWORD_MD5;

  if (!email || !senhaMd5) {
    throw new Error(
      'Variáveis de ambiente IMOVIEW_EMAIL e/ou IMOVIEW_PASSWORD_MD5 não configuradas'
    );
  }

  const url = new URL(`${IMOVIEW_BASE_URL}/Usuario/App_ValidarAcesso`);
  url.searchParams.set('email', email);
  url.searchParams.set('senha', senhaMd5);

  console.log(`Autenticando na Imoview em: ${url.toString()}`);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      chave: imoviewKey,
    },
  });

  const status = response.status;
  const data = await response.json().catch(() => null);

  console.log('Resposta App_ValidarAcesso:', status, JSON.stringify(data, null, 2));

  if (!response.ok) {
    throw new Error(`Falha ao autenticar na Imoview (status ${status})`);
  }

  const codigoAcesso = data?.codigoacesso || data?.codigoAcesso;
  const codigoUsuario = data?.codigousuario || data?.codigoUsuario;

  if (!codigoAcesso || !codigoUsuario) {
    throw new Error('Resposta da Imoview sem codigoacesso/codigousuario');
  }

  return {
    codigoAcesso: String(codigoAcesso),
    codigoUsuario: Number(codigoUsuario),
  };
}

// Busca o atendimento pelo código usando o endpoint oficial da Imoview
async function buscarAtendimentoPorCodigo(
  codigoAtendimento: string | number,
  imoviewKey: string
) {
  const { codigoAcesso, codigoUsuario } = await obterCodigoAcesso(imoviewKey);

  // Usar endpoint oficial de atendimentos (não mais o de Lead, que está retornando 404)
  const url = new URL(`${IMOVIEW_BASE_URL}/Atendimento/App_RetornarAtendimentos`);
  url.searchParams.set('numeroPagina', '1');
  url.searchParams.set('numeroRegistros', '100');
  url.searchParams.set('codigoUsuario', String(codigoUsuario));
  url.searchParams.set('textoPesquisa', String(codigoAtendimento));

  console.log(`Buscando atendimento na Imoview: ${url.toString()}`);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      chave: imoviewKey,
      codigoacesso: codigoAcesso,
    },
  });

  const status = response.status;
  const data = await response.json().catch(() => null);

  console.log('Resposta Lead/App_RetornarAtendimentos:', status, JSON.stringify(data, null, 2));

  if (!response.ok) {
    throw new Error(`Erro na API Imoview Lead/App_RetornarAtendimentos (status ${status})`);
  }

  if (!data || !Array.isArray(data.lista)) {
    throw new Error('Resposta da Imoview sem lista de atendimentos');
  }

  const atendimentoEncontrado = data.lista.find(
    (item: any) =>
      item?.codigo == codigoAtendimento ||
      String(item?.codigo) === String(codigoAtendimento)
  );

  if (!atendimentoEncontrado) {
    return null;
  }

  return atendimentoEncontrado;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Extrair código do atendimento
    const codigoAtendimento = body.codigo;

    // Fila Sonax calculada a partir do perfil do atendimento (pode sobrescrever a padrão)
    let filaSonaxOverride: string | null = null;

    if (!codigoAtendimento) {
      console.error('Código do atendimento não encontrado no webhook:', body);
      return NextResponse.json(
        { error: 'Código do atendimento não encontrado' },
        { status: 400 }
      );
    }

    // Tentar extrair telefone direto do webhook primeiro (compatibilidade)
    let telefone: string | null =
      body.leads_celular || body.telefone || body.celular || null;

    if (telefone) {
      console.log(`Telefone encontrado diretamente no webhook: ${telefone}`);
    }

    // Se não tiver telefone, buscar na API Imoview
    if (!telefone) {
      console.log(
        `Telefone não encontrado no webhook. Buscando dados do atendimento ${codigoAtendimento} na API Imoview...`
      );

      const imoviewKey = process.env.IMOVIEW_KEY;
      if (!imoviewKey) {
        console.error('Variável de ambiente IMOVIEW_KEY não configurada');
        // 200 para não gerar reenvio do webhook, mas sinalizando erro
        return NextResponse.json(
          {
            success: false,
            message: 'Configuração da API Imoview ausente (IMOVIEW_KEY).',
          },
          { status: 200 }
        );
      }

      try {
        const atendimento = await buscarAtendimentoPorCodigo(
          codigoAtendimento,
          imoviewKey
        );

        if (!atendimento) {
          console.error(
            `Atendimento ${codigoAtendimento} não encontrado na Imoview`
          );
          return NextResponse.json(
            {
              success: false,
              message: 'Atendimento não encontrado na Imoview',
              codigoAtendimento,
            },
            { status: 200 }
          );
        }

        console.log(
          `🎯 Atendimento encontrado na Imoview: ${JSON.stringify(
            atendimento,
            null,
            2
          )}`
        );

        telefone =
          extrairTelefoneGenerico(atendimento) ||
          extrairTelefoneGenerico(atendimento.cliente);

        const nome =
          atendimento.nomelead || // Campo específico de atendimentos de leads
          atendimento.nomepessoa ||
          atendimento.nomePessoa ||
          atendimento.nome ||
          atendimento.cliente?.nome ||
          '';

        console.log('📋 Dados extraídos da Imoview:');
        console.log(`   Nome: ${nome}`);
        console.log(`   Telefone bruto: ${telefone}`);

        // Selecionar fila Sonax com base no perfil do atendimento (valor do imóvel/faixa)
        filaSonaxOverride = selecionarFilaSonaxPorPerfil(atendimento);
        console.log(`   Fila Sonax sugerida: ${filaSonaxOverride ?? 'padrão'}`);
      } catch (err) {
        console.error('Erro ao consultar API Imoview:', err);
        return NextResponse.json(
          {
            success: false,
            message: 'Erro ao consultar API Imoview',
            codigoAtendimento,
          },
          { status: 200 }
        );
      }
    }

    if (!telefone) {
      console.error('Telefone não encontrado nem no webhook nem na Imoview');
      return NextResponse.json(
        {
          success: false,
          message:
            'Telefone não encontrado nos dados do webhook nem na API Imoview',
          codigoAtendimento,
        },
        { status: 200 }
      );
    }

    // Aplicar higienização do telefone
    const telefoneLimpo = cleanPhoneNumber(telefone);

    if (telefoneLimpo.length < 10) {
      console.error('Número de telefone inválido após limpeza:', telefoneLimpo);
      return NextResponse.json(
        {
          success: false,
          message: 'Número de telefone inválido após limpeza',
          telefone: telefoneLimpo,
        },
        { status: 200 }
      );
    }

    // Verificar variáveis de ambiente da Sonax
    let sonaxQueueId = process.env.SONAX_QUEUE_ID || '';
    const sonaxToken = process.env.SONAX_TOKEN;

    // Se calculamos uma fila específica pelo perfil, ela sobrescreve a padrão
    if (filaSonaxOverride) {
      sonaxQueueId = filaSonaxOverride;
    }

    if (!sonaxQueueId || !sonaxToken) {
      console.error('Variáveis de ambiente da Sonax não configuradas');
      return NextResponse.json(
        {
          success: false,
          message: 'Configuração da API Sonax ausente (fila/token)',
        },
        { status: 200 }
      );
    }

    // Construir URL da API Sonax
    const sonaxUrl = new URL('https://api.sonax.net.br/sonax-queue2call.php');
    sonaxUrl.searchParams.append('telefone', telefoneLimpo);
    sonaxUrl.searchParams.append('fila', sonaxQueueId);
    sonaxUrl.searchParams.append('token', sonaxToken);

    // Fazer requisição para a API Sonax
    console.log(`Disparando chamada para ${telefoneLimpo} via Sonax`);

    const sonaxResponse = await fetch(sonaxUrl.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!sonaxResponse.ok) {
      const errorText = await sonaxResponse.text();
      console.error('Erro na API Sonax:', sonaxResponse.status, errorText);

      // Retorna 200 para o Imoview mesmo com erro na Sonax
      return NextResponse.json(
        {
          success: false,
          message: 'Erro ao processar chamada na Sonax',
          telefone: telefoneLimpo,
          sonaxError: errorText,
        },
        { status: 200 }
      );
    }

    const sonaxResultText = await sonaxResponse.text();
    console.log('Resposta bruta da Sonax:', sonaxResultText);

    let sonaxResult;
    try {
      sonaxResult = JSON.parse(sonaxResultText);
    } catch (e) {
      sonaxResult = { raw: sonaxResultText, error: 'Failed to parse JSON' };
    }

    console.log('Chamada disparada com sucesso na Sonax:', sonaxResult);

    return NextResponse.json({
      success: true,
      message: 'Chamada disparada com sucesso',
      codigoAtendimento,
      telefone: telefoneLimpo,
      telefoneOriginal: telefone,
      telefoneAntesLimpeza: telefone,
      telefoneDepoisLimpeza: telefoneLimpo,
      sonaxResponse: sonaxResult,
    });
  } catch (error) {
    console.error('Erro no webhook Imoview:', error);

    // Sempre retorna 200 para o Imoview para evitar reenvios
    return NextResponse.json(
      {
        success: false,
        message: 'Erro interno ao processar webhook',
        error: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 200 }
    );
  }
}

// Suporte para método OPTIONS (CORS)
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
