import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Extrair número de telefone do lead (verifica múltiplos campos possíveis)
    const telefone = body.leads_celular || body.telefone || body.celular;
    
    if (!telefone) {
      console.error('Nenhum número de telefone encontrado no webhook:', body);
      return NextResponse.json(
        { error: 'Telefone não encontrado' },
        { status: 400 }
      );
    }

    // Limpar o número de telefone (remover tudo que não for número)
    const telefoneLimpo = telefone.replace(/\D/g, '');
    
    if (telefoneLimpo.length < 10) {
      console.error('Número de telefone inválido:', telefone);
      return NextResponse.json(
        { error: 'Número de telefone inválido' },
        { status: 400 }
      );
    }

    // Verificar variáveis de ambiente
    const sonaxQueueId = process.env.SONAX_QUEUE_ID;
    const sonaxToken = process.env.SONAX_TOKEN;
    
    if (!sonaxQueueId || !sonaxToken) {
      console.error('Variáveis de ambiente da Sonax não configuradas');
      return NextResponse.json(
        { error: 'Configuração da API Sonax ausente' },
        { status: 500 }
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
      return NextResponse.json({
        success: false,
        message: 'Erro ao processar chamada na Sonax',
        sonaxError: errorText
      }, { status: 200 });
    }

    const sonaxResult = await sonaxResponse.json();
    console.log('Chamada disparada com sucesso:', sonaxResult);

    return NextResponse.json({
      success: true,
      message: 'Chamada disparada com sucesso',
      telefone: telefoneLimpo,
      sonaxResponse: sonaxResult
    });

  } catch (error) {
    console.error('Erro no webhook Imoview:', error);
    
    // Sempre retorna 200 para o Imoview para evitar reenvios
    return NextResponse.json({
      success: false,
      message: 'Erro interno ao processar webhook',
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    }, { status: 200 });
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
