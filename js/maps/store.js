// Temporary compatibility shim for clients with cached pre-removal modules.
// The maps feature is gone; these no-op functions only prevent old cached code from crashing.
export async function listPackages(){ return []; }
export async function clearPlaces(){}
export async function deletePackage(){}
export async function deleteTripPlaces(){}
