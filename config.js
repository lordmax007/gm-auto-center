// Dados da empresa que aparecem no cabeçalho do PDF. Edite aqui e publique de novo.
window.VISTORIA_CONFIG = {
  appName: "Vistoria Digital",          // aparece no rodapé do PDF
  empresa: "GM Auto Center",
  cnpj: "65.741.636/0001-30",
  telefone: "(65) 99677-5961 / (65) 99649-4557",
  endereco: "Avenida Castelo Branco, 1057",
  logo: "assets/logo.jpg",               // deixe "" para ficar sem logo
  numeroInicial: 1,                      // primeiro número de vistoria neste aparelho
  corPrincipal: [240, 108, 11],           // RGB do cabeçalho do PDF (laranja extraído da logo)

  // Salvar na nuvem (acessar as vistorias de qualquer aparelho). Veja o passo a passo no README.
  // Deixe os dois vazios para guardar só neste aparelho.
  supabaseUrl: "https://olcibhimjxypdeyrtmcq.supabase.co",
  supabaseKey: "sb_publishable_brwQsb6Wi7VG2eAOTjigSg_VfqetgJq",
  exigirLogin: true                      // false = abre direto, sem login. true = pede e-mail e senha (veja o README)
};
