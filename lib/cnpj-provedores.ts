/**
 * Orquestra a consulta de CNPJ entre provedores: BrasilAPI é o principal
 * (já com sua própria política de retentativa, ver `lib/brasilapi.ts`). Se
 * ela falhar por rate limit (429) ou indisponibilidade (502) — nunca por
 * CNPJ genuinamente inexistente (404), onde tentar outro provedor não
 * ajudaria — tenta a ReceitaWS como reserva antes de desistir.
 *
 * O erro final propagado é sempre o da BrasilAPI (mensagem já conhecida
 * pelo resto do app), a menos que a ReceitaWS tenha sucesso; se a reserva
 * também falhar, isso só é logado, nunca lançado no lugar do erro original.
 */
import { consultarCNPJNaBrasilAPI, BrasilAPIError, type EmpresaBrasilAPI } from "./brasilapi";
import { consultarCNPJNaReceitaWS, ReceitaWSError } from "./receitaws";

export async function consultarCNPJComFallback(cnpj: string): Promise<EmpresaBrasilAPI> {
  try {
    return await consultarCNPJNaBrasilAPI(cnpj);
  } catch (erroPrincipal) {
    const podeTentarReserva = erroPrincipal instanceof BrasilAPIError && (erroPrincipal.status === 429 || erroPrincipal.status === 502);

    if (!podeTentarReserva) {
      throw erroPrincipal;
    }

    try {
      const dados = await consultarCNPJNaReceitaWS(cnpj);
      console.error(`BrasilAPI falhou (status ${erroPrincipal.status}) para ${cnpj} — atendido pela ReceitaWS.`);
      return dados;
    } catch (erroReserva) {
      const mensagemReserva = erroReserva instanceof ReceitaWSError ? erroReserva.message : String(erroReserva);
      console.error(`Reserva ReceitaWS também falhou para ${cnpj}: ${mensagemReserva}`);
      throw erroPrincipal;
    }
  }
}
