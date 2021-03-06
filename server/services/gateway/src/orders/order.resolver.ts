import { Client, ClientProxy, Transport } from "@nestjs/microservices";
import {
    Resolver,
    Context,
    Mutation,
    Args,
    Query,
    ResolveProperty,
    Parent
} from "@nestjs/graphql";
import { UseGuards } from "@nestjs/common";
import { config, ProductDTO, OrderDTO, UserDTO } from "@commerce/shared";

import { AuthGuard } from "../middlewares/auth.guard";
import { CreateOrder } from "./create-order.validation";
import { OrderProductDataLoader } from "../loaders/order-product.loader";
import { OrderService } from "./order.service";
import { UUID } from "../shared/validation/uuid.validation";
import { UserDataLoader } from "../loaders/user.loader";

@Resolver("Order")
export class OrderResolver {
    @Client({
        transport: Transport.REDIS,
        options: {
            url: `redis://${config.REDIS_URL}:${config.REDIS_PORT}`
        }
    })
    private client: ClientProxy;

    constructor(
        private readonly orderService: OrderService,
        private readonly usersDataLoader: UserDataLoader,
        private readonly orderProductLoader: OrderProductDataLoader
    ) {}
    @ResolveProperty("user", () => UserDTO)
    async user(@Parent() order: OrderDTO): Promise<UserDTO> {
        return this.usersDataLoader.load(order.user_id);
    }
    @ResolveProperty("products", () => ProductDTO)
    async products(@Parent() order): Promise<ProductDTO> {
        return this.orderProductLoader.loadMany(order.products);
    }
    @Query()
    @UseGuards(new AuthGuard())
    orders(@Context("user") user: any): Promise<OrderDTO[]> {
        return this.orderService.indexOrdersByUser(user.id);
    }
    @Mutation()
    @UseGuards(new AuthGuard())
    deleteOrder(@Args("order") { id }: UUID, @Context("user") user: any) {
        return this.orderService.destroyUserOrder(id, user.id);
    }
    @Mutation()
    @UseGuards(new AuthGuard())
    createOrder(
        @Args("products") products: CreateOrder[],
        @Context("user") user: any
    ): Promise<ProductDTO> {
        return new Promise((resolve, reject) => {
            // fetch products user is trying to purchase to check on the quantity.
            this.client
                .send<ProductDTO[]>(
                    "fetch-products-by-ids",
                    products.map(product => product.id)
                )
                .subscribe(
                    async fetchedProducts => {
                        const filteredProducts = products.filter(product => {
                            const p = fetchedProducts.find(
                                p => p.id === product.id
                            );
                            return p.quantity >= product.quantity;
                        });
                        // there is something wrong with the quantity of passed products.
                        if (filteredProducts.length != products.length) {
                            return reject(
                                "Products are out of stock at the moment, try with lower stock."
                            );
                        }
                        return resolve(
                            await this.orderService.store(
                                products,
                                user.id,
                                fetchedProducts
                            )
                        );
                    },
                    error => reject(error)
                );
        });
    }
}
