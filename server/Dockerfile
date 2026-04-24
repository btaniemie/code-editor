FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn package -q

FROM eclipse-temurin:17-jre
RUN apt-get update && apt-get install -y nodejs python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/target/codereview-server.jar .
CMD ["java", "-jar", "codereview-server.jar"]
