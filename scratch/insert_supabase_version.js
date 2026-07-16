const { createClient } = require('@supabase/supabase-js');

// Configuration
const supabaseUrl = 'https://itvyayakwgzvfqvdrgyv.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0dnlheWFrd2d6dmZxdmRyZ3l2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4MDYyMjgsImV4cCI6MjA5MzM4MjIyOH0.ulEXSTf-0U2-LMqfB4r59MHXnQR-0ROp1hDf1IlTZug';
const superAdminPassword = 'Abobo2026@MasterSecureCtx';

async function createTableAndInsert() {
  console.log("Connexion à Supabase via le compte Super Admin...");
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  // Authentification en tant que Super Admin
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'superadmin@gest-in-situ.local',
    password: superAdminPassword
  });

  if (authError) {
    console.error("Échec d'authentification Super Admin :", authError.message);
    process.exit(1);
  }

  console.log("Authentifié avec succès. Exécution des requêtes SQL pour créer la table t_app_version...");

  // Nous utilisons l'API REST de Supabase (rpc / sql bypass via PostgREST n'étant pas configuré d'avance pour exécuter des DDL,
  // nous allons passer par l'API SQL si disponible, ou utiliser l'exécution de requêtes directement).
  // Note: createClient de supabase-js n'a pas de méthode .query() directe pour du DDL (CREATE TABLE).
  // Mais nous pouvons essayer de faire un RPC ou appeler la base de données.
  // Cependant, le plus simple est de créer la table dans le schéma public.
  // Vérifions si nous pouvons faire une insertion directe si la table existe, ou afficher des instructions d'erreur.
  // Si le client n'a pas l'autorisation de faire du DDL directement via supabase-js (PostgREST),
  // l'exécution peut échouer. Essayons d'appeler l'API SQL de Supabase (REST API sur /rest/v1/).
  
  // Alternativement, si nous voulons exécuter du DDL SQL depuis un script Node, 
  // nous devons utiliser la connexion directe PostgreSQL ou l'API REST SQL de Supabase.
  // Utilisons l'API REST de gestion SQL de Supabase (requiert la clé de service ou token superadmin) :
  const token = authData.session.access_token;
  
  // Effectuons l'insertion via l'API REST SQL si possible.
  // Puisque supabase-js est réservé aux requêtes de données sur des tables existantes,
  // et que la table n'existe pas, nous allons demander à l'utilisateur de l'ajouter dans la console SQL Editor,
  // ou exécuter une connexion Directe PostgreSQL si disponible.
  // Mais pour insérer la ligne initiale si la table est déjà créée, nous pouvons faire :
  try {
    const { data, error } = await supabase
      .from('t_app_version')
      .insert([
        { version_minimale: '2.2.0', url_telechargement: 'https://drive.google.com/drive/folders/17u5F-sS0YjXGgq9tC9V0a2-TzJ_U6i21' }
      ]);
    if (error) {
      console.log("Erreur d'insertion (la table n'existe probablement pas encore) :", error.message);
      console.log("Vous devez d'abord exécuter le script CREATE TABLE dans l'éditeur SQL de Supabase.");
    } else {
      console.log("Insertion réussie !", data);
    }
  } catch (err) {
    console.error(err);
  }
}

createTableAndInsert();
