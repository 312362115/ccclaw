import { getProducts, findProduct, addProduct } from './store.js';
import type { Product } from './types.js';

export function handleGetProducts(): Product[] {
  return getProducts();
}

export function handleGetProduct(id: number): Product | null {
  return findProduct(id) ?? null;
}

export function handleCreateProduct(name: string, price: number): Product {
  const product: Product = { id: Date.now(), name, price };
  addProduct(product);
  return product;
}
